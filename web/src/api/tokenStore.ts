import type { KeyStore, StoredSession } from "./keyStore";

/**
 * The signed-in session. The token is held in memory and written to IndexedDB (so a reload stays
 * signed in), sent as a Bearer header, and cleared on a 401. It is never put in localStorage or a URL.
 */
export class TokenStore {
  private session: StoredSession | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly keys: KeyStore) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSession = (): StoredSession | null => this.session;

  /** The token to send, if any. */
  token = (): string | null => this.session?.token ?? null;

  /** Reads the saved session on start-up. A session past its expiry is dropped. */
  async load(now = Date.now()): Promise<StoredSession | null> {
    let saved: StoredSession | null;
    try {
      saved = await this.keys.loadSession();
    } catch {
      saved = null;
    }
    if (saved && new Date(saved.expiresAt).getTime() <= now) {
      await this.clear();
      saved = null;
    }
    this.session = saved;
    this.emit();
    return saved;
  }

  async set(session: StoredSession): Promise<void> {
    this.session = session;
    this.emit();
    try {
      await this.keys.saveSession(session);
    } catch {
      // Still signed in for this visit; a reload will ask again.
    }
  }

  async update(patch: Partial<StoredSession>): Promise<void> {
    if (this.session) await this.set({ ...this.session, ...patch });
  }

  async clear(): Promise<void> {
    this.session = null;
    this.emit();
    try {
      await this.keys.clearSession();
    } catch {
      // Nothing else to do: memory is already clear.
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
