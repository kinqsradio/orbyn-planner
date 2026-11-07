import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryKeyStore, emptySyncState, withMemoryFallback, type SyncState } from "../../api/keyStore";
import { MemoryOnlyGuard } from "./MemoryOnlyGuard";

const keys = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ services: { keys: keys.current } }) }));
afterEach(cleanup);

const closing = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const held = () => {
  const store = withMemoryFallback(createMemoryKeyStore());
  store.holdInMemory();
  keys.current = store;
  return store;
};
const state = (over: Partial<SyncState>): SyncState => ({ ...emptySyncState(), ...over });

describe("closing a tab that holds an account in memory only", () => {
  it("asks first while a zone made here has no key that reached another device, and stops asking the moment one does", async () => {
    const store = held();
    render(<MemoryOnlyGuard />);
    await act(async () => store.saveSyncState(state({ made: { zone: true }, keysSent: { zone: "owes-nobody" } }))); // marked as sent, but nothing was put
    expect(closing()).toBe(true);
    await act(async () => store.saveSyncState(state({ made: { zone: true }, keysSent: { zone: "d2" }, keysReached: { zone: true } })));
    expect(closing()).toBe(false); // at once, on the saved state: no timer to wait for
  });

  it("does not ask when no zone was made here", async () => {
    const store = held();
    render(<MemoryOnlyGuard />);
    await act(async () => store.saveSyncState(state({})));
    expect(closing()).toBe(false);
  });
});
