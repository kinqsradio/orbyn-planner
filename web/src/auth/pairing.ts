import { ApiFailure } from "../api/auth";
import type { ApproverPairing, DevicePairing } from "../api/authCrypto";
import type { StoredSession } from "../api/keyStore";
import type { Device } from "../generated/Device";
import type { AuthServices, PollSchedule } from "./services";

/**
 * The two screens of adding a device: the trusted device that approves (A) and the new one (D),
 * following the engine's two-way comparison step by step. Each is a small state machine the
 * screens show. One attempt each: a cancel, a mismatch, an expiry or a failure closes it, and the
 * only way on is a new approval. Neither keeps anything but memory, so a reload ends an attempt.
 */

export type CloseReason = "cancelled" | "mismatch" | "expired" | "closed" | "failed";

const REASONS: Record<CloseReason, string> = {
  cancelled: "This approval was cancelled.",
  mismatch: "The digits didn’t match, so this approval was closed.",
  expired: "This approval ran out of time.",
  closed: "This approval was closed, by the other device or because it ran out of time.",
  failed: "Something went wrong, so this approval was closed.",
};

export type ApproverState =
  | { phase: "starting" }
  /** Created; waiting for the new device to join. */
  | { phase: "waiting" }
  /** Both show the digits; nothing is approved until the person says they match. */
  | { phase: "compare"; sas: string; fingerprint: string }
  | { phase: "confirming" }
  /** Confirmed here; waiting for the new device to finish. */
  | { phase: "finishing" }
  | { phase: "done" }
  | { phase: "closed"; reason: CloseReason; message: string };

export type DeviceState =
  /** No approval yet: waiting for a trusted device to start one. */
  | { phase: "waiting" }
  | { phase: "joining" }
  /** Joined; waiting for the approver to reveal. */
  | { phase: "joined" }
  | { phase: "compare"; sas: string }
  /** Confirmed here; waiting for the approver to confirm, then finishing. */
  | { phase: "finishing" }
  | { phase: "trusted" }
  | { phase: "closed"; reason: CloseReason; message: string };

class Controller<S> {
  protected state: S;
  private listeners = new Set<() => void>();
  protected disposed = false;
  private wake: (() => void) | null = null;

  constructor(initial: S) {
    this.state = initial;
  }

  getState = (): S => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  protected set(next: S): void {
    if (this.disposed) return;
    this.state = next;
    for (const l of this.listeners) l();
  }

  /** Stops waiting and polling; the screen has gone. */
  dispose(): void {
    this.disposed = true;
    this.wake?.();
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = null;
        resolve();
      };
    });
  }

  /** Asks again sooner than the schedule says (the person did something). */
  protected nudge(): void {
    this.wake?.();
  }
}

/** The waits between asks: first, then 1.5 times longer each time up to the maximum. */
export function* delays(poll: PollSchedule): Generator<number> {
  let ms = poll.firstMs;
  for (;;) {
    yield ms;
    ms = Math.min(Math.round(ms * 1.5), poll.maxMs);
  }
}

const nowSecs = (services: AuthServices) => Math.floor(services.now() / 1000);
const isGone = (e: unknown) => e instanceof ApiFailure && (e.status === 404 || e.status === 410 || e.code === "approval_expired" || e.code === "invalid_commitment");

/** The trusted device's side. */
export class ApproverController extends Controller<ApproverState> {
  private id: string | null = null;
  private pairing: ApproverPairing | null = null;
  private ended = false;

  constructor(
    private readonly services: AuthServices,
    private readonly session: StoredSession,
    private readonly pending: Device,
  ) {
    super({ phase: "starting" });
  }

  /** Creates the approval and walks to the comparison. */
  async start(): Promise<void> {
    try {
      this.pairing = await this.services.engine.run(this.session, (e) => e.startApproval(this.pending, nowSecs(this.services)));
      const created = await this.services.api.createApproval(this.pairing.createRequest);
      this.id = created.id;
      this.set({ phase: "waiting" });
      // The new device sends its nonce once it has seen the approval; then this device reveals.
      const view = await this.poll(async () => {
        const v = await this.services.api.approval(created.id);
        return v.device_nonce ? v : undefined;
      });
      if (!view) return;
      await this.services.api.revealNonce(created.id, this.pairing.reveal(view));
      const sas = this.pairing.sas();
      if (!sas) throw new Error("failed: no digits after reveal");
      this.set({ phase: "compare", sas, fingerprint: this.pairing.deviceFingerprint() });
      // While the person compares, notice if the other device closes the approval.
      void this.poll(async () => {
        if (this.state.phase !== "compare") return true;
        await this.services.api.approval(created.id);
        return undefined;
      }).catch((e: unknown) => this.fail(e));
    } catch (e) {
      await this.fail(e);
    }
  }

  /** "They match": only now does this device sign the approval. */
  async confirm(): Promise<void> {
    if (this.state.phase !== "compare" || !this.pairing || !this.id) return;
    const id = this.id;
    this.set({ phase: "confirming" });
    try {
      const devices = await this.services.api.devices();
      const pairing = this.pairing;
      const body = await this.services.engine.run(this.session, (e) => e.confirmApproval(pairing, devices));
      await this.services.api.confirmApproval(id, body);
      this.set({ phase: "finishing" });
      const done = await this.poll(async () => {
        const list = await this.services.api.devices();
        if (list.devices.find((d) => d.id === this.pending.id)?.state === "trusted") return true;
        await this.services.api.approval(id); // a closed approval answers 410
        return undefined;
      });
      if (done) this.set({ phase: "done" });
    } catch (e) {
      await this.fail(e);
    }
  }

  /** Closes the approval, from any step. */
  async cancel(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    this.nudge();
    if (this.id) await this.services.api.cancelApproval(this.id).catch(() => undefined);
    this.set({ phase: "closed", reason: "cancelled", message: REASONS.cancelled });
  }

  private async poll<T>(ask: () => Promise<T | undefined>): Promise<T | undefined> {
    let waited = 0;
    for (const delay of delays(this.services.poll)) {
      const got = await ask();
      if (got !== undefined) return got;
      if (this.disposed || this.ended) return undefined;
      if (waited >= this.services.poll.totalMs) throw new ApiFailure("poll_timeout", 0, "timed out");
      await this.sleep(delay);
      waited += delay;
      if (this.disposed || this.ended) return undefined;
    }
    return undefined;
  }

  private async fail(error: unknown): Promise<void> {
    if (this.ended || this.disposed) return;
    this.ended = true;
    let reason: CloseReason = "failed";
    let message: string = REASONS.failed;
    if (error instanceof ApiFailure && error.code === "poll_timeout") {
      reason = "expired";
      message = REASONS.expired;
    } else if (isGone(error)) {
      reason = "closed";
      message = REASONS.closed;
    } else if (error instanceof Error && /^keys_changed:/.test(error.message)) {
      reason = "mismatch";
      message = "The keys the server showed for the new device changed, so this approval was closed.";
    } else if (error instanceof ApiFailure) {
      message = error.message;
    }
    if (this.id) await this.services.api.cancelApproval(this.id).catch(() => undefined);
    this.set({ phase: "closed", reason, message });
  }
}

/** The new device's side. */
export class DeviceController extends Controller<DeviceState> {
  private pairing: DevicePairing | null = null;
  private approvalId: string | null = null;
  private typed: string | undefined;
  /** Approvals this attempt gave up on; a new attempt waits for a different one. */
  private dead = new Set<string>();
  private running = false;
  private budget = 0;

  /**
   * `repair`: this device is already trusted by the server, and a trusted device approves it again
   * because that device no longer trusts it. The server lists it as trusted either way, so this
   * never stops at "trusted"; it follows the approval it is given.
   */
  constructor(
    private readonly services: AuthServices,
    private readonly session: StoredSession,
    private readonly repair = false,
  ) {
    super({ phase: "waiting" });
  }

  /** Polls until trusted, closed or disposed. Safe to call again after "Start again". */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const delay of delays(this.services.poll)) {
        if (this.disposed) return;
        const stop = await this.tick();
        if (stop || this.disposed) return;
        await this.sleep(delay);
        // Ten minutes from joining; while no approval exists the wait has no end.
        if (this.approvalId) {
          this.budget += delay;
          if (this.budget >= this.services.poll.totalMs) {
            await this.close("expired");
            return;
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async tick(): Promise<boolean> {
    if (this.state.phase === "closed" || this.state.phase === "trusted") return true;
    let current;
    try {
      current = await this.services.api.currentDevice();
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) return true; // signed out already
      return false; // try again next time
    }
    if (current.device.state === "trusted" && !this.repair) {
      await this.continue();
      return true;
    }
    const view = current.approval && !this.dead.has(current.approval.id) ? current.approval : null;
    try {
      if (!view && this.repair && !this.approvalId) {
        this.set({ phase: "closed", reason: "closed", message: REASONS.closed });
        return true;
      }
      if (!view) {
        // An approval we were in has gone: closed from the other side, or timed out.
        if (this.approvalId) await this.close("closed", false);
        return (this.state as DeviceState).phase === "closed";
      }
      if (this.approvalId !== view.id) {
        this.set({ phase: "joining" });
        this.pairing = await this.services.engine.run(this.session, (e) => e.joinApproval(view, nowSecs(this.services)));
        this.approvalId = view.id;
        this.budget = 0;
        await this.services.api.submitNonce(view.id, this.pairing.nonce);
        this.set({ phase: "joined" });
        return false;
      }
      if (this.state.phase === "joined" && view.approver_nonce) {
        this.set({ phase: "compare", sas: this.pairing!.sas(view) });
        return false;
      }
      if (this.state.phase === "finishing" && view.signature && this.pairing) {
        const pairing = this.pairing;
        const code = await this.services.engine.run(this.session, (e) => e.finishApproval(pairing, view, this.typed, nowSecs(this.services)));
        await this.services.api.submitCode(view.id, { code });
        // The planner opens on "Continue", so the person sees that this device is trusted.
        this.set({ phase: "trusted" });
        return true;
      }
      return false;
    } catch (e) {
      if (view) this.dead.add(view.id);
      await this.fail(e);
      return true;
    }
  }

  /** Opens the planner: this device's session is now a trusted one. */
  async continue(): Promise<void> {
    await this.services.tokens.update({ deviceState: "trusted" });
    this.set({ phase: "trusted" });
  }

  /** "They match" (or the typed digits): this device then waits for the approver and finishes. */
  confirm(typed?: string): void {
    if (this.state.phase !== "compare") return;
    const digits = typed?.replace(/\s+/g, "");
    this.typed = digits ? digits : undefined;
    this.set({ phase: "finishing" });
    this.nudge();
  }

  /** Closes the approval, from any step. */
  async cancel(): Promise<void> {
    await this.close("cancelled");
  }

  /** After a close, waits for a new approval. */
  startAgain(): void {
    this.approvalId = null;
    this.pairing = null;
    this.typed = undefined;
    this.budget = 0;
    this.set({ phase: "waiting" });
    void this.run();
  }

  private async close(reason: CloseReason, tellServer = true): Promise<void> {
    const id = this.approvalId;
    if (id) {
      this.dead.add(id);
      if (tellServer) await this.services.api.cancelApproval(id).catch(() => undefined);
    }
    this.set({ phase: "closed", reason, message: REASONS[reason] });
  }

  private async fail(error: unknown): Promise<void> {
    const text = error instanceof Error ? error.message : "";
    if (error instanceof ApiFailure && error.code === "wrong_code") return this.close("mismatch");
    if (/^(commitment_mismatch|wrong_code|invalid_signature):/.test(text)) return this.close("mismatch");
    if (/^approval_expired:/.test(text)) return this.close("expired");
    if (isGone(error)) return this.close("closed", false);
    return this.close("failed");
  }
}
