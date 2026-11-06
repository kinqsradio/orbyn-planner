import { ApiFailure } from "../api/auth";
import { engineUrl } from "../api/engine";
import type { AuthServices } from "../auth/services";
import type { SyncServerMessage } from "../generated/SyncServerMessage";
import type { PlannerStore } from "../store/types";
import { runCycle, SyncError, type CycleReport } from "./cycle";

export type SyncPhase =
  /** Not syncing: signed out, an untrusted device, or no engine. */
  | "off"
  /** Between passes, up to date. */
  | "idle"
  | "syncing"
  /** The network or the engine can't be reached; changes wait here. */
  | "offline"
  /** A failure that waiting won't fix, with `error` saying what. */
  | "error";

export interface SyncState {
  phase: SyncPhase;
  /** Trusted devices on the account, from the last pass. */
  devices: number;
  lastSyncedAt: string | null;
  /** Records this device can't open yet. */
  quarantined: number;
  /** Zones with changes waiting for a key from another device. */
  waitingForKeys: string[];
  error: string | null;
  /** Whether this tab holds the sync (the live socket and the passes), or another tab does. */
  leader: boolean;
  /** The live socket is open. */
  live: boolean;
}

const OFF: SyncState = { phase: "off", devices: 0, lastSyncedAt: null, quarantined: 0, waitingForKeys: [], error: null, leader: false, live: false };

/** The part of a WebSocket the controller uses. */
export interface SocketLike {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface SyncOptions {
  /** Opens the live socket; the browser's WebSocket by default. */
  socket?: (url: string) => SocketLike;
  /** Holds `hold` for as long as it should run, only in the one tab that gets the lock; Web Locks by default. */
  lock?: (hold: () => Promise<void>) => Promise<void>;
  /** The engine address; the build's by default. */
  baseUrl?: string;
  /** Timers; replaced in tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  online?: () => boolean;
  /** Seconds-scale delays, replaced in tests. */
  delays?: { debounceMs: number; pollMs: number; retryMs: [number, number]; socketMs: [number, number] };
}

const LOCK = "orbyn-planner-sync";
const STATUS_CHANNEL = "orbyn-planner-sync-status";
const DEFAULT_DELAYS = { debounceMs: 400, pollMs: 60_000, retryMs: [2000, 60_000] as [number, number], socketMs: [1000, 30_000] as [number, number] };

/** http(s) to ws(s), keeping the path. */
export function socketUrl(base: string): string {
  return `${base.replace(/\/+$/, "").replace(/^http/i, "ws")}/v1/sync`;
}

/**
 * Keeps a signed-in, trusted device's data in step with the engine, local-first: the planner works the same
 * offline, and this only moves what has changed. One tab at a time (the one that gets a Web Lock) runs the
 * passes and holds the live socket; the others see the results as the store's own changes, which the leader
 * writes through the patch path and the store tells them about. A notice on the socket is only a hint to
 * run a pass, never data.
 */
export class SyncController {
  private state: SyncState = OFF;
  private listeners = new Set<() => void>();
  private running = false;
  private again = false;
  private stopped = true;
  private timer: unknown = null;
  private poll: unknown = null;
  private retry = 0;
  private socket: SocketLike | null = null;
  private socketTry = 0;
  private socketTimer: unknown = null;
  private unsubscribeStore: (() => void) | null = null;
  private releaseLock: (() => void) | null = null;
  private status: BroadcastChannel | null = null;
  private lastPending = -1;
  private readonly set: (fn: () => void, ms: number) => unknown;
  private readonly clear: (id: unknown) => void;
  private readonly delays: NonNullable<SyncOptions["delays"]>;

  constructor(
    private readonly services: AuthServices,
    private readonly store: PlannerStore,
    private readonly options: SyncOptions = {},
  ) {
    this.set = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clear = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
    this.delays = options.delays ?? DEFAULT_DELAYS;
  }

  getState = (): SyncState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
    if (this.state.leader) {
      try {
        const { devices, lastSyncedAt, quarantined, phase, waitingForKeys, error } = this.state;
        this.status?.postMessage({ devices, lastSyncedAt, quarantined, phase, waitingForKeys, error });
      } catch {
        // Other tabs just don't hear it.
      }
    }
  }

  private online = (): boolean => this.options.online?.() ?? (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean" ? navigator.onLine : true);

  /** Starts: the tab that gets the lock becomes the leader, the others follow its status. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.update({ phase: "idle" });
    if (typeof BroadcastChannel !== "undefined") {
      this.status = new BroadcastChannel(STATUS_CHANNEL);
      this.status.onmessage = (e: MessageEvent) => {
        // A follower shows what the leader tab last reported.
        if (this.state.leader) return;
        this.state = { ...this.state, ...(e.data as Partial<SyncState>) };
        for (const l of this.listeners) l();
      };
    }
    const lock = this.options.lock ?? defaultLock;
    void lock(
      () =>
        new Promise<void>((resolve) => {
          if (this.stopped) return resolve();
          this.releaseLock = resolve;
          this.lead();
        }),
    );
  }

  /** Stops everything, and gives the lock to another tab. */
  stop(): void {
    this.stopped = true;
    this.closeSocket();
    this.clearTimers();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.status?.close();
    this.status = null;
    this.releaseLock?.();
    this.releaseLock = null;
    this.state = OFF;
    for (const l of this.listeners) l();
  }

  /** Runs a pass now (or as soon as the one in progress ends). */
  syncNow(): void {
    if (this.stopped || !this.state.leader) return;
    if (this.running) {
      this.again = true;
      return;
    }
    void this.pass();
  }

  private clearTimers(): void {
    if (this.timer) this.clear(this.timer);
    if (this.poll) this.clear(this.poll);
    if (this.socketTimer) this.clear(this.socketTimer);
    this.timer = this.poll = this.socketTimer = null;
  }

  private lead(): void {
    this.update({ leader: true });
    // A pass soon after any change to the outbox, from this tab or another.
    this.lastPending = this.store.getState().outbox.length;
    this.unsubscribeStore = this.store.subscribe(() => {
      const pending = this.store.getState().outbox.length;
      if (pending !== this.lastPending) {
        this.lastPending = pending;
        if (pending > 0) this.later(this.delays.debounceMs);
      }
    });
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
    this.openSocket();
    this.syncNow();
    this.schedulePoll();
  }

  private onOnline = () => {
    this.retry = 0;
    this.update({ phase: this.state.phase === "offline" ? "idle" : this.state.phase });
    this.openSocket();
    this.syncNow();
  };
  private onOffline = () => this.update({ phase: "offline" });

  private later(ms: number): void {
    if (this.timer) this.clear(this.timer);
    this.timer = this.set(() => {
      this.timer = null;
      this.syncNow();
    }, ms);
  }

  private schedulePoll(): void {
    this.poll = this.set(() => {
      this.syncNow();
      this.schedulePoll();
    }, this.delays.pollMs);
  }

  private async pass(): Promise<void> {
    const session = this.services.tokens.getSession();
    if (!session || session.deviceState !== "trusted" || this.stopped) return;
    if (!this.online()) {
      this.update({ phase: "offline" });
      return;
    }
    this.running = true;
    this.update({ phase: "syncing", error: null });
    try {
      const report: CycleReport = await runCycle(this.services, session, this.store);
      this.retry = 0;
      this.update({ phase: "idle", devices: report.devices, lastSyncedAt: new Date(this.services.now()).toISOString(), quarantined: report.quarantined, waitingForKeys: report.waitingForKeys, error: null });
      if (report.waitingForKeys.length > 0) this.later(this.delays.retryMs[0]); // a key may arrive any moment
    } catch (error) {
      this.failed(error);
    } finally {
      this.running = false;
    }
    if (this.again && !this.stopped) {
      this.again = false;
      this.syncNow();
    }
  }

  private failed(error: unknown): void {
    if (error instanceof ApiFailure && error.status === 401) {
      this.update({ phase: "off", leader: this.state.leader });
      return;
    }
    if (error instanceof SyncError && error.code !== "network") {
      this.update({ phase: "error", error: error.message });
      return;
    }
    const wait = error instanceof ApiFailure && error.retryAfter ? error.retryAfter * 1000 : Math.min(this.delays.retryMs[0] * 2 ** this.retry, this.delays.retryMs[1]);
    this.retry += 1;
    const unreachable = error instanceof TypeError || (error instanceof ApiFailure && (error.code === "network" || error.status >= 500 || error.status === 0));
    this.update({ phase: unreachable || !this.online() ? "offline" : "error", error: unreachable ? null : error instanceof Error ? error.message : "Couldn’t sync." });
    this.later(wait);
  }

  // The live socket -----------------------------------------------------------------------------------------

  private openSocket(): void {
    if (this.stopped || this.socket || !this.online()) return;
    const token = this.services.tokens.token();
    if (!token) return;
    const url = socketUrl(this.options.baseUrl ?? engineUrl());
    let ws: SocketLike;
    try {
      ws = (this.options.socket ?? ((u) => new WebSocket(u) as unknown as SocketLike))(url);
    } catch {
      this.reconnect();
      return;
    }
    this.socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
    ws.onmessage = (event) => {
      let message: SyncServerMessage;
      try {
        message = JSON.parse(String(event.data)) as SyncServerMessage;
      } catch {
        return;
      }
      if (message.type === "ready") {
        this.socketTry = 0;
        this.update({ live: true });
        this.syncNow(); // after a (re)connect, compare every zone: notices missed meanwhile are gaps
      } else if (message.type === "zone_changed" || message.type === "resync") {
        this.syncNow();
      } else if (message.type === "error") {
        ws.close();
      }
    };
    ws.onclose = () => {
      if (this.socket === ws) this.socket = null;
      this.update({ live: false });
      this.reconnect();
    };
    ws.onerror = () => undefined; // a close follows
  }

  private reconnect(): void {
    if (this.stopped || this.socketTimer) return;
    const [first, max] = this.delays.socketMs;
    const wait = Math.min(first * 2 ** this.socketTry, max);
    this.socketTry += 1;
    this.socketTimer = this.set(() => {
      this.socketTimer = null;
      this.openSocket();
    }, wait * (0.75 + Math.random() * 0.5));
  }

  private closeSocket(): void {
    const ws = this.socket;
    this.socket = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
    }
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }
}

/** Web Locks where there are any; otherwise this tab is the leader. */
function defaultLock(hold: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return hold();
  return locks.request(LOCK, hold) as Promise<void>;
}
