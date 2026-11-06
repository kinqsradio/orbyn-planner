import type { SocketLike } from "../../sync/controller";
import type { MockEngine } from "./MockEngine";

/** A stand-in for `/v1/sync`: the first message must be the auth, then `ready`, then a notice for other devices' writes. */
export class MockSocket implements SocketLike {
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  device: string | null = null;
  private account: string | null = null;
  private stop: (() => void) | null = null;

  constructor(private readonly engine: MockEngine, readonly registry: Set<MockSocket>) {
    registry.add(this);
    queueMicrotask(() => !this.closed && this.onopen?.({}));
  }

  private emit(message: unknown): void {
    if (!this.closed) this.onmessage?.({ data: JSON.stringify(message) });
  }

  send(data: string): void {
    const message = JSON.parse(data) as { type: string; token?: string };
    if (message.type !== "auth" || this.device) return this.closeFromServer();
    const session = message.token ? this.engine.sessions.get(message.token) : undefined;
    if (!session) {
      this.emit({ type: "error", code: "unauthorized", message: "Not signed in." });
      return this.closeFromServer();
    }
    this.account = session.accountId;
    this.device = session.deviceId;
    this.stop = this.engine.subscribe((account, zone, token, author) => {
      if (account === this.account && author !== this.device) this.emit({ type: "zone_changed", zone, token });
    });
    this.emit({ type: "ready", device_id: this.device });
  }

  /** The server sends `resync`: the listener reconnected, or this socket fell behind. */
  resync(): void {
    this.emit({ type: "resync" });
  }

  /** The server closes the socket. */
  closeFromServer(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop?.();
    this.registry.delete(this);
    this.onclose?.({});
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stop?.();
    this.registry.delete(this);
  }
}

export function mockSockets(engine: MockEngine): { open: Set<MockSocket>; factory: (url: string) => SocketLike; urls: string[] } {
  const open = new Set<MockSocket>();
  const urls: string[] = [];
  return {
    open,
    urls,
    factory: (url) => {
      urls.push(url);
      return new MockSocket(engine, open);
    },
  };
}
