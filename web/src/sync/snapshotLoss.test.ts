// @vitest-environment node
//
// An outbox entry is cleared only after it was sent. The sync state says which entries are already staged in
// the engine, but that is only true while the engine's snapshot is: wherever the snapshot is dropped or
// replaced, the sync state's engine-side parts are reset with it, so every entry is staged again.
import { describe, expect, it } from "vitest";
import { removeZone, runCycle } from "./cycle";
import { createSyncRig, type TestDevice } from "./testing/rig";

const sync = (d: TestDevice) => runCycle(d.services, d.session, d.store);
const titles = (d: TestDevice) => d.store.getState().tasks.map((t) => t.title).sort();

/** A has an edit staged in the engine whose upload failed, then loses its snapshot the way `lose` says. */
async function strand(lose: (d: TestDevice) => Promise<void>) {
  const r = await createSyncRig();
  r.a.store.addTask({ title: "Seed" });
  await sync(r.a);
  await sync(r.b);
  r.a.store.addTask({ title: "Staged but not sent" });
  r.network.refuseUploads.set("list:inbox", { status: 500, code: "internal" });
  await sync(r.a).catch(() => undefined); // staged in the engine; the upload failed
  r.network.refuseUploads.clear();
  expect((await r.a.keys.loadSyncState())?.staged).not.toEqual({});
  await lose(r.a);
  return r;
}

/**
 * The fresh engine trusts nobody and holds no zone keys. Until the device is trusted again and another device
 * sends the keys, the edit must wait in the outbox (not be cleared as sent); then it goes up as if nothing happened.
 */
async function recover(r: Awaited<ReturnType<typeof strand>>) {
  const report = await sync(r.a);
  expect(report.waitingForKeys).toContain("list:inbox");
  expect(r.a.store.getState().outbox.some((o) => o.type === "task")).toBe(true); // not cleared unsent
  await r.a.services.engine.run(r.a.session, (e) => e.sync?.pinDevice(r.b.id, r.b.device.signing_key, r.b.device.agreement_key));
  const state = (await r.b.keys.loadSyncState())!;
  await r.b.keys.saveSyncState({ ...state, keysSent: {} }); // what B does when the set of trusted devices is verified again
  await sync(r.b);
  await sync(r.a);
  await sync(r.a);
  await sync(r.b);
}

describe("an edit staged in an engine that is then gone is staged again, not cleared unsent", () => {
  it("the reviewer's probe: stage an edit, fail its upload, clear the snapshot; B still gets the record", async () => {
    const r = await strand((a) => a.keys.clearSnapshot());
    expect((await r.a.keys.loadSyncState())?.staged).toEqual({}); // reset with the snapshot, in the same step
    await recover(r);
    expect(titles(r.b)).toContain("Staged but not sent");
    expect(r.a.store.getState().outbox).toEqual([]);
  });

  it("the engine host drops a snapshot made for another device id (a new device id at sign-in)", async () => {
    const r = await strand(async (a) => {
      await a.keys.saveIdentity({ accountId: a.session.accountId, deviceId: "00000000-0000-4000-8000-0000000000ff" });
      await a.services.engine.run(a.session, () => undefined); // the host sees the mismatch
    });
    expect((await r.a.keys.loadSyncState())?.staged).toEqual({});
    await recover(r);
    expect(titles(r.b)).toContain("Staged but not sent");
  });

  it("the engine host quarantines a snapshot that can't be read", async () => {
    const r = await strand(async (a) => {
      await a.keys.saveSnapshot(new Uint8Array([1, 2, 3]));
      await a.services.engine.run(a.session, () => undefined);
    });
    expect((await r.a.keys.loadSyncState())?.staged).toEqual({});
    expect(await r.a.keys.loadQuarantine()).not.toEqual([]);
    await recover(r);
    expect(titles(r.b)).toContain("Staged but not sent");
  });

  it("signing in to the same account with a new device id", async () => {
    const r = await strand(async (a) => {
      // What flows.signIn does when the saved identity names another device of this account.
      await a.keys.saveIdentity({ accountId: a.session.accountId, deviceId: "00000000-0000-4000-8000-0000000000fe" });
      await a.keys.clearSnapshot();
    });
    expect((await r.a.keys.loadSyncState())?.staged).toEqual({});
  });

  it("a create that was never acknowledged survives the refetch: it is staged again and sent, not trashed", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Seed" });
    await sync(r.a);
    await sync(r.b);
    const unsent = r.a.store.addTask({ title: "Never sent" });
    r.network.down = true;
    await sync(r.a).catch(() => undefined);
    r.network.down = false;
    await r.a.keys.clearSnapshot(); // and with it the zone tokens: the next pass fetches everything again
    await recover(r);
    expect(titles(r.a)).toContain("Never sent"); // still on screen
    const trash = await r.a.services.engine.run(r.a.session, (e) => JSON.parse(e.sync!.trash("list:inbox")) as Record<string, unknown>);
    expect(Object.keys(trash)).not.toContain(unsent.id);
    expect(titles(r.b)).toContain("Never sent");
    expect(r.a.store.getState().outbox).toEqual([]);
  });
});

describe("a zone no device can open", () => {
  /** A made a list and its key; B never got it. A then lost its keys (snapshot gone) and trusts nobody: it is alone and keyless. */
  async function stranded() {
    const r = await createSyncRig();
    const trip = r.a.store.addList("Trip", "c3");
    r.a.store.addTask({ title: "Passport", listId: trip.id });
    await sync(r.a);
    await r.a.keys.clearSnapshot();
    return { r, zone: `list:${trip.id}`, trip };
  }

  it("is reported as stranded when this is the only trusted device and it has no key", async () => {
    const { r, zone } = await stranded();
    const report = await sync(r.a);
    expect(report.stranded).toContain(zone); // and the other zones this device had made, with their keys
    expect(report.stranded).toContain("list:inbox");
  });

  it("is not reported while another trusted device could still send the key", async () => {
    const { r } = await stranded();
    await r.a.services.engine.run(r.a.session, (e) => e.sync?.pinDevice(r.b.id, r.b.device.signing_key, r.b.device.agreement_key));
    expect((await sync(r.a)).stranded).toEqual([]);
  });

  it("a zone this device made itself is never stranded", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Mine" });
    await sync(r.a);
    expect((await sync(r.a)).stranded).toEqual([]);
  });

  it("Remove deletes it for the account through the signed delete, and the unsent changes for it are dropped", async () => {
    const { r, zone, trip } = await stranded();
    r.a.store.addTask({ title: "Unsent into the stranded list", listId: trip.id });
    expect((await sync(r.a)).stranded).toContain(zone);
    await removeZone(r.a.services, r.a.session, zone);
    const after = await sync(r.a);
    expect(after.stranded).not.toContain(zone);
    expect(after.dropped.map((d) => d.zone)).toEqual([zone]);
    expect(r.a.store.getState().outbox.some((o) => o.type === "task")).toBe(false);
    await sync(r.b);
    expect(r.b.store.getState().lists.some((l) => l.id === trip.id)).toBe(false); // deleted for the account
  });
});
