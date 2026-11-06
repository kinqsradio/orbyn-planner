// @vitest-environment node
//
// An outbox entry is cleared only after it was sent. The sync state says which entries are already staged in
// the engine, but that is only true while the engine's snapshot is: wherever the snapshot is dropped or
// replaced, the sync state's engine-side parts are reset with it, so every entry is staged again.
import { describe, expect, it } from "vitest";
import { resendKeysAfterApproval } from "../auth/resendKeys";
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
 * The fresh engine trusts nobody and holds no zone keys, while the server still lists the other device as trusted: the
 * device says it must be approved again (nothing is called waiting or stranded), and its edit waits in the outbox, not
 * cleared as sent. When the approval completes (both pin each other, and each side forgets what keys it sent), the other
 * device resends every zone key, and the edit goes up as if nothing had happened.
 */
async function recover(r: Awaited<ReturnType<typeof strand>>) {
  const report = await sync(r.a);
  expect(report.needsApproval).toBe(true);
  expect(report.waitingForKeys).toEqual([]);
  expect(report.stranded).toEqual([]);
  expect(r.a.store.getState().outbox.some((o) => o.type === "task")).toBe(true); // not cleared unsent
  await r.a.services.engine.run(r.a.session, (e) => e.sync?.pinDevice(r.b.id, r.b.device.signing_key, r.b.device.agreement_key));
  await resendKeysAfterApproval(r.a.services);
  await resendKeysAfterApproval(r.b.services);
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
    await resendKeysAfterApproval(r.a.services); // approved again once since the reset (and then B was removed)
    // B is gone for good: the server lists no other trusted device either.
    const account = [...r.engine.accounts.values()][0]!;
    account.devices = account.devices.filter((d) => d.id !== r.b.id);
    return { r, zone: `list:${trip.id}`, trip };
  }

  it("is reported as stranded when this is the only trusted device and it has no key", async () => {
    const { r, zone } = await stranded();
    const report = await sync(r.a);
    expect(report.stranded).toContain(zone); // and the other zones this device had made, with their keys
    expect(report.stranded).toContain("list:inbox");
  });

  it("is not reported while another trusted device could still send the key (this device's own view shows one)", async () => {
    const { r } = await stranded();
    await r.a.services.engine.run(r.a.session, (e) => e.sync?.pinDevice(r.b.id, r.b.device.signing_key, r.b.device.agreement_key));
    const account = [...r.engine.accounts.values()][0]!;
    account.devices.push(r.b.device); // and the server lists it
    expect((await sync(r.a)).stranded).toEqual([]);
  });

  it("the reviewer's probe: after a snapshot loss with B still trusted, nothing is stranded and no Remove is offered", async () => {
    const r = await createSyncRig();
    const trip = r.a.store.addList("Trip", "c3");
    r.a.store.addTask({ title: "Passport", listId: trip.id });
    await sync(r.a);
    await sync(r.b);
    await r.a.keys.clearSnapshot(); // A's engine now trusts only itself; the server lists B as trusted
    const report = await sync(r.a);
    expect(report.stranded).toEqual([]);
    expect(report.needsApproval).toBe(true);
    expect(report.waitingForKeys).toEqual([]); // one clear state, replacing any stranded or waiting one
  });

  it("a snapshot loss, then B approves A again: A gets the keys, and its unsent edit reaches B", async () => {
    const r = await strand((a) => a.keys.clearSnapshot());
    await recover(r);
    expect(titles(r.b)).toContain("Staged but not sent");
    expect(r.a.store.getState().outbox).toEqual([]);
    expect((await sync(r.a)).needsApproval).toBe(false);
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
    const listed = await r.a.services.api.zones();
    expect(listed.zones.find((z) => z.zone === zone)?.deleted ?? true).toBe(true); // deleted for the account
  });
});

describe("three devices: a re-approval makes every trusted device resend the keys it holds", () => {
  it("C made a list, A lost its snapshot, B approves A again: A ends up with C's list too", async () => {
    const r = await createSyncRig({ third: true });
    const trip = r.c.store.addList("Trip", "c3");
    r.c.store.addTask({ title: "Passport", listId: trip.id });
    r.b.store.addTask({ title: "From B" });
    const mine = r.a.store.addList("Mine", "c1"); // a zone A made: only B and C hold its key besides A
    r.a.store.addTask({ title: "In A's own list", listId: mine.id });
    for (const d of [r.c, r.b, r.a, r.c, r.b, r.a]) await sync(d); // everyone has everything, and each has seen the others' approvals
    expect(r.a.store.getState().lists.some((l) => l.id === trip.id)).toBe(true);
    r.a.store.addTask({ title: "A's unsent edit" });
    await r.a.keys.clearSnapshot();
    // Envelopes A already took are not delivered again (a server that kept them would need no resend at all).
    const records = [...r.engine.accounts.values()][0]!.records!;
    records.envelopes = records.envelopes.filter((e) => e.recipient_device_id !== r.a.id);
    expect((await sync(r.a)).needsApproval).toBe(true);
    // B approves A again: both pin each other, and the server now lists A with a new approval. C is not involved at all.
    await r.a.services.engine.run(r.a.session, (e) => {
      for (const d of [r.b, r.c]) e.sync?.pinDevice(d.id, d.device.signing_key, d.device.agreement_key);
    });
    // B and C keep trusting A as before (a pinned device stays verified whatever its row says), so only the approval changed.
    for (const d of [r.b, r.c]) await d.services.engine.run(d.session, (e) => e.sync?.pinDevice(r.a.id, r.a.device.signing_key, r.a.device.agreement_key));
    r.a.device.approval_id = "00000000-0000-4000-8000-0000000000a9";
    await sync(r.b); // B and C each see the new approval on their next pass and send every key they hold
    await sync(r.c);
    for (const d of [r.a, r.a, r.b, r.c]) await sync(d);
    expect(r.a.store.getState().lists.some((l) => l.id === trip.id)).toBe(true); // C's list, opened on A
    expect(r.a.store.getState().tasks.map((t) => t.title)).toContain("Passport");
    // The zone A made: no envelope was ever sent to A for it, so only a resend from B or C gives its key back.
    r.a.store.addTask({ title: "Added to Mine after recovery", listId: mine.id });
    await sync(r.a);
    await sync(r.c);
    expect(titles(r.c)).toContain("Added to Mine after recovery");
    expect(titles(r.c)).toContain("A's unsent edit"); // and A's outbox went up
    expect((await sync(r.a)).needsApproval).toBe(false);
  });
});

describe("a server can't make a reset device look like the account's only device", () => {
  it("with the other devices hidden from the list, a reset device still says it must be approved again, and offers no Remove", async () => {
    const r = await createSyncRig();
    const trip = r.a.store.addList("Trip", "c3");
    r.a.store.addTask({ title: "Passport", listId: trip.id });
    await sync(r.a);
    await sync(r.b);
    await r.a.keys.clearSnapshot(); // A's engine is reset
    const account = [...r.engine.accounts.values()][0]!;
    account.devices = account.devices.filter((d) => d.id !== r.b.id); // and the server hides B: both views now show nobody else
    const report = await sync(r.a);
    expect(report.stranded).toEqual([]);
    expect(report.needsApproval).toBe(true);
    expect((await r.a.keys.loadSyncState())?.reset).toBe(true); // persisted
    // Once this device has been approved again (an approval completed here), the flag ends.
    await resendKeysAfterApproval(r.a.services);
    expect((await r.a.keys.loadSyncState())?.reset).toBe(false);
    expect((await sync(r.a)).stranded).toContain(`list:${trip.id}`);
  });
});

describe("keys are resent for a changed approval at most once per value and once per ten minutes", () => {
  it("a server that changes approval_id on every poll doesn't make every pass resend every key", async () => {
    const r = await createSyncRig();
    r.a.store.addTask({ title: "Seed" });
    for (const d of [r.a, r.b, r.a, r.b]) await sync(d);
    const real = r.engine.fetch;
    let sends = 0;
    r.engine.fetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(url).endsWith("/v1/keychain/envelopes")) sends++;
      return real(url, init);
    }) as typeof fetch;
    const flip = (n: number) => void (r.a.device.approval_id = `00000000-0000-4000-8000-0000000000${(10 + n).toString(16)}`);
    flip(1);
    await sync(r.b);
    const first = sends;
    expect(first).toBeGreaterThan(0); // the first change is acted on
    for (let i = 2; i <= 6; i++) {
      flip(i);
      r.clock.now += 30_000;
      await sync(r.b);
    }
    expect(sends).toBe(first); // five more flips within ten minutes: nothing more is sent
    flip(7);
    r.clock.now += 11 * 60_000;
    await sync(r.b);
    expect(sends).toBeGreaterThan(first); // after ten minutes the latest change is acted on
    const after = sends;
    await sync(r.b); // the same value again: once per value
    expect(sends).toBe(after);
    r.engine.fetch = real;
  });
});
