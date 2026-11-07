import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptySyncState, type SyncState } from "../../api/keyStore";
import { MemoryOnlyGuard } from "./MemoryOnlyGuard";

let state: SyncState | null = null;
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ services: { keys: { loadSyncState: () => Promise.resolve(state) } } }) }));
afterEach(cleanup);

const closing = async () => {
  render(<MemoryOnlyGuard />);
  await new Promise((r) => setTimeout(r, 10));
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("closing a tab that holds an account in memory only", () => {
  it("asks first while a zone made here has no key sent yet", async () => {
    state = { ...emptySyncState(), made: { zone: true }, keysSent: {} };
    expect(await closing()).toBe(true);
  });
  it("does not ask once the key was sent, or when no zone was made", async () => {
    state = { ...emptySyncState(), made: { zone: true }, keysSent: { zone: "d1" } };
    expect(await closing()).toBe(false);
    cleanup();
    state = null;
    expect(await closing()).toBe(false);
  });
});
