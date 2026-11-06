import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReminderScheduler } from "./schedule";
import { listenShown, loadShown, rememberShown } from "./shown";
import type { Task } from "../../store/types";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
afterEach(() => vi.restoreAllMocks());

describe("the shared channel", () => {
  it("opens one BroadcastChannel however many keys are remembered and listeners added", async () => {
    const real = globalThis.BroadcastChannel;
    let opened = 0;
    globalThis.BroadcastChannel = class extends real {
      constructor(name: string) {
        super(name);
        opened += 1;
      }
    } as typeof BroadcastChannel;
    try {
      const stops = [listenShown(() => undefined), listenShown(() => undefined)];
      for (let i = 0; i < 5; i++) await rememberShown(`k${i}`);
      expect(opened).toBe(1);
      stops.forEach((s) => s());
    } finally {
      globalThis.BroadcastChannel = real;
    }
  });
});

describe("remembering a shown key", () => {
  it("settles when the key is written", async () => {
    await rememberShown("t1|1");
    expect([...(await loadShown())]).toEqual(["t1|1"]);
  });

  it("rejects when the write fails, so the caller can say so", async () => {
    vi.spyOn(globalThis.indexedDB, "open").mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(rememberShown("t1|1")).rejects.toThrow();
  });

  it("the scheduler reports a key it couldn't record", async () => {
    const t = { id: "t1", title: "x", reminder: 0, due: "2026-11-07T12:00", done: false, deletedAt: null } as Task;
    const errors: string[] = [];
    const now = new Date(2026, 10, 7, 12, 5);
    const s = new ReminderScheduler({
      now: () => now,
      quiet: () => ({ enabled: false, from: "22:00", to: "07:00" }),
      notify: () => undefined,
      onShown: () => Promise.reject(new Error("quota")),
      onShownError: (key) => void errors.push(key),
    });
    s.update([t]);
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toHaveLength(1);
    s.stop();
  });
});
