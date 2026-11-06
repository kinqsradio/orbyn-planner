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
  /** Another tab of this browser answers this approval; this one waits and never cancels it. */
  | { phase: "elsewhere" }
  | { phase: "compare"; sas: string }
  /** Confirmed here; waiting for the approver to confirm, then finishing. */
  | { phase: "finishing" }
  | { phase: "trusted" }
  | { phase: "closed"; reason: CloseReason; message: string };

class Controller<S> {
  protected state: S;
  private listeners = new Set<() => void>();
  protected disposed = false;
  /** Set when the attempt is over (closed, cancelled, failed). Nothing that was already under way may change the state or post after it. */
  protected ended = false;
  private wake: (() => void) | null = null;

  constructor(initial: S) {
    this.state = initial;
  }

  getState = (): S => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Sets the state. After the attempt ended only the final closing state may be set (`final`). */
  protected set(next: S, final = false): void {
    if (this.disposed) return;
    if (this.ended && !final) return;
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

/** An approval is good for ten minutes. */
const APPROVAL_SECS = 600;
const nowSecs = (services: AuthServices) => Math.floor(services.now() / 1000);
/** The approval is at another step: another tab of this device got there first. */
const isOutOfOrder = (e: unknown) => e instanceof ApiFailure && (e.status === 409 || e.code === "approval_out_of_order");
const isGone = (e: unknown) => e instanceof ApiFailure && (e.status === 404 || e.status === 410 || e.code === "approval_expired" || e.code === "invalid_commitment");

/** The trusted device's side. */
export class ApproverController extends Controller<ApproverState> {
  private id: string | null = null;
  private pairing: ApproverPairing | null = null;

  constructor(
    private readonly services: AuthServices,
    private readonly session: StoredSession,
    private readonly pending: Device,
  ) {
    super({ phase: "starting" });
  }

  /** Creates the approval and walks to the comparison. After a cancel nothing here posts or changes the screen. */
  async start(): Promise<void> {
    try {
      const pairing = await this.services.engine.run(this.session, (e) => e.startApproval(this.pending, nowSecs(this.services)));
      if (this.ended || this.disposed) return;
      this.pairing = pairing;
      const created = await this.services.api.createApproval(pairing.createRequest);
      this.id = created.id;
      if (this.ended) {
        // Cancelled while it was being created: close what the server just made.
        await this.services.api.cancelApproval(created.id).catch(() => undefined);
        return;
      }
      this.set({ phase: "waiting" });
      // The new device sends its nonce once it has seen the approval; then this device reveals.
      const view = await this.poll(async () => {
        const v = await this.services.api.approval(created.id);
        return v.device_nonce ? v : undefined;
      });
      if (!view || this.ended || this.disposed) return;
      const nonce = pairing.reveal(view);
      await this.services.api.revealNonce(created.id, nonce);
      if (this.ended || this.disposed) return;
      const sas = pairing.sas();
      if (!sas) throw new Error("failed: no digits after reveal");
      this.set({ phase: "compare", sas, fingerprint: pairing.deviceFingerprint() });
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

  /** "They match": only now does this device sign the approval, and never after a cancel. */
  async confirm(): Promise<void> {
    if (this.ended || this.state.phase !== "compare" || !this.pairing || !this.id) return;
    const id = this.id;
    const pairing = this.pairing;
    this.set({ phase: "confirming" });
    try {
      const devices = await this.services.api.devices();
      if (this.ended || this.disposed) return;
      const body = await this.services.engine.run(this.session, (e) => e.confirmApproval(pairing, devices)); // signs
      if (this.ended || this.disposed) return;
      await this.services.api.confirmApproval(id, body);
      if (this.ended || this.disposed) return;
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
    this.set({ phase: "closed", reason: "cancelled", message: REASONS.cancelled }, true);
  }

  private async poll<T>(ask: () => Promise<T | undefined>): Promise<T | undefined> {
    let waited = 0;
    for (const delay of delays(this.services.poll)) {
      if (this.disposed || this.ended) return undefined;
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
    } else if (error instanceof Error && /^mismatch:/.test(error.message)) {
      // The module's one code for any disagreement; at this end it means the keys the server showed are not the ones this device started with.
      reason = "mismatch";
      message = "The keys the server showed for the new device changed, so this approval was closed.";
    } else if (error instanceof ApiFailure) {
      message = error.message;
    }
    if (this.id) await this.services.api.cancelApproval(this.id).catch(() => undefined);
    this.set({ phase: "closed", reason, message }, true);
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
  /** This tab ran `finishApproval`: the engine pinned the approver here. */
  private finished = false;

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
    // The server saying "trusted" ends the wait only where there is nothing left to finish here: a
    // tab that joined an approval must run `finishApproval` itself (it pins the approver), unless it did.
    if (current.device.state === "trusted" && !this.repair && (!this.pairing || this.finished)) {
      await this.continue();
      return true;
    }
    const view = current.approval && !this.dead.has(current.approval.id) ? current.approval : null;
    try {
      if (!view && this.repair && !this.approvalId) {
        this.ended = true;
        this.set({ phase: "closed", reason: "closed", message: REASONS.closed }, true);
        return true;
      }
      if (!view) {
        // An approval we were in has gone: closed from the other side, or timed out.
        if (this.approvalId) await this.close("closed", false);
        return (this.state as DeviceState).phase === "closed";
      }
      if (this.approvalId !== view.id) {
        // The module refuses an approval older than ten minutes with its generic `mismatch`, so the age is checked here to say so.
        if (nowSecs(this.services) - view.created_at > APPROVAL_SECS) {
          this.dead.add(view.id);
          await this.close("expired", false);
          return true;
        }
        this.set({ phase: "joining" });
        const pairing = await this.services.engine.run(this.session, (e) => e.joinApproval(view, nowSecs(this.services)));
        this.approvalId = view.id;
        this.budget = 0;
        try {
          await this.services.api.submitNonce(view.id, pairing.nonce);
        } catch (e) {
          if (!isOutOfOrder(e)) throw e;
          // Another tab of this device already sent its nonce and owns the approval; it is not ours to cancel.
          this.set({ phase: "elsewhere" });
          return false;
        }
        this.pairing = pairing;
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
        this.finished = true;
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
    if (this.ended) return;
    await this.close("cancelled");
  }

  /** After a close, waits for a new approval. */
  startAgain(): void {
    this.approvalId = null;
    this.pairing = null;
    this.typed = undefined;
    this.budget = 0;
    this.finished = false;
    this.ended = false;
    this.set({ phase: "waiting" });
    void this.run();
  }

  private async close(reason: CloseReason, tellServer = true): Promise<void> {
    this.ended = true;
    const id = this.approvalId;
    if (id) {
      this.dead.add(id);
      if (tellServer) await this.services.api.cancelApproval(id).catch(() => undefined);
    }
    this.set({ phase: "closed", reason, message: REASONS[reason] }, true);
  }

  private async fail(error: unknown): Promise<void> {
    const text = error instanceof Error ? error.message : "";
    if (error instanceof ApiFailure && error.code === "wrong_code") return this.close("mismatch");
    // The module has one code for every disagreement: the digits, a nonce against its commitment, the signature.
    if (/^mismatch:/.test(text)) return this.close("mismatch");
    if (isGone(error)) return this.close("closed", false);
    return this.close("failed");
  }
}
