// @vitest-environment node
//
// The review of the sync PR, as tests: keys before uploads and retried until confirmed, a zone that can't be
// stranded, one refused upload not stopping the rest, a stopped pass changing nothing, strict record types,
// per-field times, and a remote delete meeting local edits.
import { describe, expect, it } from "vitest";
import { encodeBytes } from "../api/bytes";
import { Aborted, runCycle } from "./cycle";
import { acceptable } from "./mapping";
import { createSyncRig, type SyncRig, type TestDevice } from "./testing/rig";

const sync = (d: TestDevice, signal?: { aborted: boolean }) => runCycle(d.services, d.session, d.store, undefined, signal);
const account = (r: SyncRig) => [...r.engine.accounts.values()][0]!;
const zoneRecords = (r: SyncRig, zone: string) => account(r).records?.zones.get(zone)?.records.size ?? 0;
const titles = (d: TestDevice) => d.store.getState().tasks.map((t) => t.title).sort();

describe("keys go out before records, and are retried until the server took them", () => {
  it("a refused key send keeps the zone from being uploaded to, and the next pass sends it", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Waits for keys" });
    r.network.refuseKeys = true;
    const first = await sync(r.a);
    expect(first.keysPending).toContain("list:inbox");
    expect(zoneRecords(r, "list:inbox")).toBe(0); // nothing went up without the keys
    expect(r.a.store.getState().outbox.length).toBeGreaterThan(0);
    r.network.refuseKeys = false;
    const second = await sync(r.a);
    expect(second.keysPending).toEqual([]);
    expect(zoneRecords(r, "list:inbox")).toBeGreaterThan(0);
    await sync(r.b);
    expect(titles(r.b)).toEqual(["Waits for keys"]);
  });

  it("a connection lost while sending the keys is picked up next pass, still before any record", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Crash safe" });
    const real = r.engine.fetch;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(url).endsWith("/v1/keychain/envelopes")) throw new TypeError("Failed to fetch");
      return real(url, init);
    }) as typeof fetch;
    await expect(sync(r.a)).rejects.toThrow();
    expect(zoneRecords(r, "list:inbox")).toBe(0);
    r.engine.fetch = real;
    await sync(r.a);
    await sync(r.b);
    expect(titles(r.b)).toEqual(["Crash safe"]);
  });
});

describe("a zone can't be stranded without its key", () => {
  it("the key is made before the zone, so a connection lost in between leaves a key and no stranded zone", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Zone later" });
    r.network.dropZoneMake = true; // the request to make the zone never gets through
    await expect(sync(r.a)).rejects.toThrow();
    expect(account(r).records?.zones.has("list:inbox") ?? false).toBe(false);
    await sync(r.a); // the key exists here already; the zone is made now, and the batch goes up
    expect(zoneRecords(r, "list:inbox")).toBeGreaterThan(0);
    await sync(r.b);
    expect(titles(r.b)).toEqual(["Zone later"]);
  });

  it("a zone someone else made, with no key here and none sent yet, waits visibly instead of being claimed", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Theirs" });
    await sync(r.a);
    const real = r.engine.fetch;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("/v1/keychain/envelopes") && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ envelopes: [] }), { status: 200 });
      return real(url, init);
    }) as typeof fetch;
    r.b.store.addTask({ title: "Mine, but no key yet" });
    const report = await sync(r.b);
    expect(report.waitingForKeys).toContain("list:inbox");
    expect(r.b.store.getState().outbox.length).toBeGreaterThan(0); // not lost, not claimed
    r.engine.fetch = real;
    await sync(r.b);
    await sync(r.a);
    expect(titles(r.a)).toContain("Mine, but no key yet");
  });
});

describe("one refused upload doesn't stop the others", () => {
  it("a zone deleted elsewhere is dropped (delete wins), the person is told, and the other zones go on", async () => {
    const r = await createSyncRig();
    const trip = r.a.store.addList("Trip", "c3");
    r.a.store.addTask({ title: "Passport", listId: trip.id });
    await sync(r.a);
    await sync(r.b);
    // B deletes the list's zone on the server.
    const zone = `list:${trip.id}`;
    const proof = await r.b.services.engine.run(r.b.session, (e) => e.sync!.deleteZoneProof(zone));
    await r.b.services.api.deleteZone(zone, JSON.parse(proof));
    // A has an unsent change in the deleted zone, and one in another.
    r.clock.now += 1000;
    r.a.store.addTask({ title: "More for the trip", listId: trip.id });
    r.a.store.addTask({ title: "Groceries" });
    const report = await sync(r.a);
    expect(report.dropped.map((d) => d.zone)).toEqual([zone]);
    expect(report.dropped[0]!.records).toBeGreaterThan(0);
    expect(r.a.store.getState().lists.some((l) => l.id === trip.id)).toBe(false);
    expect(titles(r.a)).toEqual(["Groceries"]);
    expect(r.a.store.getState().outbox).toEqual([]); // the dropped changes are cleared, the other was sent
    await sync(r.b);
    expect(titles(r.b)).toContain("Groceries");
  });

  it("any other 4xx skips that zone for a while with a backoff, and the rest is sent and cleared", async () => {
    const r = await createSyncRig();
    const home = r.a.store.addList("Home", "c2");
    await sync(r.a);
    r.network.refuseUploads.set(`list:${home.id}`, { status: 403, code: "forbidden" });
    r.a.store.addTask({ title: "Stuck", listId: home.id });
    r.a.store.addTask({ title: "Goes through" });
    const report = await sync(r.a);
    expect(report.skipped).toEqual([`list:${home.id}`]);
    await sync(r.b);
    expect(titles(r.b)).toEqual(["Goes through"]);
    expect(r.a.store.getState().outbox.map((o) => o.id).length).toBe(1); // only the refused zone's change is left
    // Within the backoff the zone isn't even tried.
    const posts = () => r.engine.calls.filter((c) => c.method === "POST" && c.path.includes(`list%3A${home.id}`) && c.path.endsWith("/changes")).length;
    const before = posts();
    await sync(r.a);
    expect(posts()).toBe(before);
    // After it, and once the server accepts, it goes.
    r.network.refuseUploads.clear();
    r.clock.now += 20 * 60_000;
    await sync(r.a);
    await sync(r.b);
    expect(titles(r.b)).toEqual(["Goes through", "Stuck"]);
    expect(r.a.store.getState().outbox).toEqual([]);
  });

  it("a record too large to send is marked, shown and left out; the others go, and editing it again tries again", async () => {
    const r = await createSyncRig();
    const big = r.a.store.addTask({ title: "Huge", notes: "x".repeat(300_000) });
    r.a.store.addTask({ title: "Small" });
    const report = await sync(r.a);
    expect(report.failed).toEqual([{ type: "task", id: big.id, reason: "It is too large to sync." }]);
    await sync(r.b);
    expect(titles(r.b)).toEqual(["Small"]);
    expect(r.a.store.getState().outbox.some((o) => o.id === big.id)).toBe(true);
    // Left alone it stays failed and isn't retried; shortened, it goes.
    expect((await sync(r.a)).failed).toHaveLength(1);
    r.clock.now += 1000;
    r.a.store.updateTask(big.id, { notes: "short now" });
    const after = await sync(r.a);
    expect(after.failed).toEqual([]);
    await sync(r.b);
    expect(titles(r.b)).toEqual(["Huge", "Small"]);
  });
});

describe("a pass that outlives stop() changes nothing", () => {
  it("stopped while a request is out, it saves no state, shows nothing, and sends nothing", async () => {
    const r = await createSyncRig();
    r.b.store.addTask({ title: "From B" });
    await sync(r.b);
    r.a.store.addTask({ title: "Local on A" });
    const posts = () => r.engine.calls.filter((c) => c.method === "POST" && c.path.endsWith("/changes")).length;
    const before = posts();
    r.network.delayMs = 40;
    const signal = { aborted: false };
    const pass = sync(r.a, signal);
    await new Promise((res) => setTimeout(res, 20));
    signal.aborted = true; // sign-out: the tab stops
    await expect(pass).rejects.toBeInstanceOf(Aborted);
    r.network.delayMs = 0;
    expect(titles(r.a)).toEqual(["Local on A"]); // B's task was not shown
    expect(posts()).toBe(before); // nothing was sent
  });

  it("never saves the sync state after the device was forgotten", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "x" });
    r.network.delayMs = 30;
    const signal = { aborted: false };
    const pass = sync(r.a, signal);
    await new Promise((res) => setTimeout(res, 10));
    await r.a.services.engine.forget(); // signed out meanwhile
    r.network.delayMs = 0;
    await pass.catch(() => undefined);
    expect(await r.a.keys.loadSyncState()).toBeNull();
    expect(await r.a.keys.loadSnapshot()).toBeNull();
  });
});

describe("the last save of a pass", () => {
  it("is not made if the device was forgotten just before it", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "x" });
    await sync(r.a); // everything is sent; the next pass has only the final save to do
    const real = r.a.store.acknowledge.bind(r.a.store);
    r.a.store.acknowledge = async (sent) => {
      await r.a.services.engine.forget(); // signed out between the clearing and the save
      return real(sent);
    };
    await expect(sync(r.a)).rejects.toBeInstanceOf(Aborted);
    expect(await r.a.keys.loadSyncState()).toBeNull();
  });
});

describe("record types are checked, not just inferred", () => {
  /** B puts a record in a zone through its engine, as a hostile or buggy device could. */
  async function plant(r: SyncRig, zone: string, type: string, id: string, fields: Record<string, unknown>) {
    await r.b.services.engine.run(r.b.session, (e) => {
      const stamp = JSON.parse(e.sync!.tick(r.clock.now));
      e.sync!.stage(zone, type, id, JSON.stringify(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { value: v, stamp }]))));
    });
  }

  it("rejects and quarantines a task in a calendar zone, an event in a list zone, and a wrong owner id", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Seed" }); // gives both devices the keys for list:inbox and calendar:personal
    await sync(r.a);
    await sync(r.b);
    await plant(r, "calendar:personal", "task", "t-in-calendar", { id: "t-in-calendar", title: "Not an event", listId: "inbox" });
    await plant(r, "list:inbox", "event", "e-in-list", { id: "e-in-list", title: "Not a task", calendarId: "personal" });
    await plant(r, "list:inbox", "task", "inbox-as-task", { id: "inbox-as-task", title: "Pretends to be the list", listId: "inbox" }); // fine: a task
    await plant(r, "list:inbox", "task", "inbox", { id: "inbox", title: "A task wearing the list's id", listId: "inbox", done: false }); // the owner's id, task-shaped
    await plant(r, "list:inbox", "task", "wrong-list", { id: "wrong-list", title: "Says another list", listId: "somewhere-else" });
    await sync(r.b);
    const report = await sync(r.a);
    expect(report.quarantined).toBeGreaterThanOrEqual(3);
    const have = titles(r.a);
    expect(have).toContain("Seed");
    expect(have).toContain("Pretends to be the list");
    for (const bad of ["Not an event", "Not a task", "Says another list", "A task wearing the list's id"]) expect(have).not.toContain(bad);
    expect(r.a.store.getState().events.some((e) => e.id === "e-in-list")).toBe(false);
  });
});

describe("each field is staged with its own time", () => {
  it("an older edit of one field doesn't take the time of a later edit of another", async () => {
    const r = await createSyncRig();
    const task = r.a.store.addTask({ title: "Plan", notes: "" });
    await sync(r.a);
    await sync(r.b);
    r.clock.now += 1000;
    r.a.store.updateTask(task.id, { title: "Plan (A, early)" }); // A edits the title at t+1s...
    r.clock.now += 2000;
    r.b.store.updateTask(task.id, { title: "Plan (B, later)" }); // ...B edits it at t+3s...
    r.clock.now += 2000;
    r.a.store.updateTask(task.id, { notes: "notes from A" }); // ...and A edits another field at t+5s, before syncing.
    await sync(r.a);
    await sync(r.b);
    await sync(r.a);
    for (const d of [r.a, r.b]) {
      const t = d.store.getState().tasks.find((x) => x.id === task.id)!;
      expect({ title: t.title, notes: t.notes }).toEqual({ title: "Plan (B, later)", notes: "notes from A" });
    }
  });
});

describe("a remote delete meets local edits waiting", () => {
  it("delete wins: the record goes from the store, the edits go to the engine's trash, and nothing is sent back", async () => {
    const r = await createSyncRig();
    const task = r.a.store.addTask({ title: "Doomed" });
    await sync(r.a);
    await sync(r.b);
    // B hard-deletes it (the purge after 30 days).
    await r.b.persistence.apply({ at: new Date(r.clock.now).toISOString(), patches: [{ type: "task", id: task.id, op: "purge", key: "p" }] });
    r.b.store = await r.reload(r.b);
    await sync(r.b);
    // A, offline, had edited it.
    r.clock.now += 1000;
    r.a.store.updateTask(task.id, { title: "Doomed but edited" });
    const report = await sync(r.a);
    expect(report.quarantined).toBe(0);
    expect(r.a.store.getState().tasks.find((t) => t.id === task.id)).toBeUndefined();
    const trash = await r.a.services.engine.run(r.a.session, (e) => JSON.parse(e.sync!.trash("list:inbox")) as Record<string, unknown>);
    expect(Object.keys(trash)).toContain(task.id);
    expect(r.a.store.getState().outbox.some((o) => o.id === task.id)).toBe(false);
    await sync(r.b);
    expect(r.b.store.getState().tasks.find((t) => t.id === task.id)).toBeUndefined(); // not resurrected
    void encodeBytes;
  });
});

describe("the outbox is cleared only for what was sent", () => {
  it("an edit made while the upload is out is staged next pass, not cleared with the older one", async () => {
    const r = await createSyncRig();
    const task = r.a.store.addTask({ title: "One" });
    await sync(r.a);
    r.a.store.updateTask(task.id, { title: "Two" });
    let edited = false;
    r.network.onUpload = () => {
      if (edited) return;
      edited = true;
      r.a.store.updateTask(task.id, { title: "Three" }); // after "Two" was staged, before its answer
    };
    await sync(r.a);
    expect(r.a.store.getState().outbox.some((o) => o.id === task.id)).toBe(true); // "Three" still waits
    r.network.onUpload = undefined;
    await sync(r.a);
    await sync(r.b);
    expect(r.b.store.getState().tasks.find((x) => x.id === task.id)?.title).toBe("Three");
  });
});

describe("keys are sent again when the set of trusted devices changes", () => {
  it("a device that became trusted after the first pass gets the zone's keys on the next one", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "For the new device" });
    const real = r.engine.fetch;
    let hideB = true;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      const response = await real(url, init);
      if (hideB && (init?.method ?? "GET") === "GET" && new URL(String(url)).pathname === "/v1/devices") {
        const body = (await response.json()) as { devices: { id: string }[] };
        return new Response(JSON.stringify({ ...body, devices: body.devices.filter((d) => d.id !== r.b.id) }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return response;
    }) as typeof fetch;
    await sync(r.a); // B is not on the list yet: the keys go to nobody else
    hideB = false;
    await sync(r.a); // B appears, with nothing to upload: the keys must still go out again
    r.engine.fetch = real;
    await sync(r.b);
    expect(titles(r.b)).toEqual(["For the new device"]);
  });
});

describe("an edit is staged at the time it was made", () => {
  it("a stale edit synced later doesn't beat a newer edit of the same field", async () => {
    const r = await createSyncRig();
    const task = r.a.store.addTask({ title: "Plan" });
    await sync(r.a);
    await sync(r.b);
    r.clock.now += 1000;
    r.a.store.updateTask(task.id, { title: "A, early" });
    r.clock.now += 2000;
    r.b.store.updateTask(task.id, { title: "B, later" });
    await sync(r.b); // B goes first
    r.clock.now += 60_000;
    await sync(r.a); // A syncs a minute later, with the older edit
    await sync(r.b);
    for (const d of [r.a, r.b]) expect(d.store.getState().tasks.find((x) => x.id === task.id)?.title).toBe("B, later");
  });
});

describe("a device-only planner added to the account", () => {
  it("is uploaded the normal way and reaches the other device", async () => {
    const r = await createSyncRig();
    const { LocalStore } = await import("../store/LocalStore");
    const { MemoryPersistence } = await import("../store/persistence");
    const device = new LocalStore({ persistence: new MemoryPersistence(), broadcast: false });
    await device.ready;
    const trip = device.addList("Trip", "c3");
    device.addTask({ title: "Passport", listId: trip.id });
    device.addTask({ title: "Charger" });
    r.a.store.adopt(device.getState());
    await sync(r.a);
    await sync(r.b);
    expect(titles(r.b)).toEqual(["Charger", "Passport"]);
    expect(r.b.store.getState().lists.some((l) => l.id === trip.id)).toBe(true);
    expect(r.a.store.getState().outbox).toEqual([]);
  });
});

describe("what the engine says a record is, and what a zone's own record looks like", () => {
  const task = { listId: "inbox", title: "x" };

  it("the engine's type must be one the zone may hold, and the server's type must agree with it (N4)", () => {
    expect(acceptable("list:inbox", "t1", "task", task, "task")).toBe("task");
    expect(acceptable("list:inbox", "t1", "task", task, "event")).toBeNull(); // the server says something else
    expect(acceptable("list:inbox", "t1", "task", task)).toBe("task");
    expect(acceptable("list:inbox", "t1", "event", { calendarId: "inbox" })).toBeNull(); // an event in a list zone
    expect(acceptable("calendar:personal", "t1", "task", task)).toBeNull(); // a task in a calendar zone
    expect(acceptable("project:p", "t1", "task", task)).toBeNull(); // a project zone holds only the project
  });

  it("the owner's id is only for the owner kind", () => {
    expect(acceptable("list:inbox", "inbox", "task", { name: "x" })).toBeNull();
    expect(acceptable("list:inbox", "t1", "list", { name: "x" })).toBeNull();
  });

  it("the zone's own record must look like a list: a task-shaped record with the owner's id is rejected", () => {
    expect(acceptable("list:inbox", "inbox", "list", { name: "Inbox", colour: "c1", isInbox: true })).toBe("list");
    expect(acceptable("list:inbox", "inbox", "list", { title: "A task wearing the list's id", listId: "inbox", done: false })).toBeNull();
    expect(acceptable("list:inbox", "inbox", "list", { name: "Inbox", listId: "inbox" })).toBeNull();
    expect(acceptable("calendar:personal", "personal", "calendar", { title: "An event", calendarId: "personal", start: "2026-11-07T10:00" })).toBeNull();
    expect(acceptable("calendar:personal", "personal", "calendar", { name: "Personal", colour: "c2" })).toBe("calendar");
  });

  it("a removal has no record: the type comes from the server or the local record", () => {
    expect(acceptable("list:inbox", "t1", undefined, null)).toBeNull();
    expect(acceptable("list:inbox", "t1", "task", null)).toBe("task");
  });
});

describe("a zone this device made is its own to key again", () => {
  it("with no key anywhere for it, a zone on the server that this device made is re-keyed here instead of waiting (N5)", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Theirs" });
    await sync(r.a);
    const real = r.engine.fetch;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("/v1/keychain/envelopes") && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ envelopes: [] }), { status: 200 });
      return real(url, init);
    }) as typeof fetch;
    const state = (await r.b.keys.loadSyncState()) ?? undefined;
    const { emptySyncState } = await import("../api/keyStore");
    await r.b.keys.saveSyncState({ ...(state ?? emptySyncState()), made: { "list:inbox": true } }); // this device made it before
    r.b.store.addTask({ title: "Mine" });
    const report = await sync(r.b);
    expect(report.waitingForKeys).not.toContain("list:inbox");
    r.engine.fetch = real;
  });
});

describe("a remote delete never takes a create that wasn't acknowledged", () => {
  it("the create reached the server but its answer was lost; B deletes the record; A keeps it and its create waits", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Seed" });
    await sync(r.a);
    await sync(r.b);
    const task = r.a.store.addTask({ title: "Created, answer lost" });
    r.network.loseAnswer = true;
    await sync(r.a).catch(() => undefined); // on the server; A never heard, so the create is still in A's outbox
    expect(r.a.store.getState().outbox.some((o) => o.id === task.id && o.op === "create")).toBe(true);
    await sync(r.b);
    expect(titles(r.b)).toContain("Created, answer lost");
    // B purges it for good: a signed delete.
    await r.b.persistence.apply({ at: new Date(r.clock.now).toISOString(), patches: [{ type: "task", id: task.id, op: "purge", key: "purge" }] });
    r.b.store = await r.reload(r.b);
    await sync(r.b);
    const report = await sync(r.a);
    expect(report.received).toBeGreaterThanOrEqual(0);
    expect(titles(r.a)).toContain("Created, answer lost"); // the removal didn't take A's unacknowledged create
  });
});
