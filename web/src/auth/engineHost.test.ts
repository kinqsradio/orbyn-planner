import { describe, expect, it } from "vitest";
import type { StoredSession } from "../api/keyStore";
import { createMemoryKeyStore } from "../api/keyStore";
import { FakeAuthCrypto, fakeSeal } from "../api/testing/FakeAuthCrypto";
import type { Device } from "../generated/Device";
import type { DeviceList } from "../generated/DeviceList";
import { QUARANTINE_KEEP } from "../api/keyStore";
import { createEngineHost, SNAPSHOT_UNREADABLE, type EngineHost } from "./engineHost";

const crypto = new FakeAuthCrypto();
const ME = "00000000-0000-4000-8000-0000000000a2";
const session: StoredSession = { token: "t", accountId: "00000000-0000-4000-8000-0000000000a1", deviceId: ME, deviceState: "trusted", expiresAt: "2030-01-01T00:00:00Z", email: "a@b.co", name: "" };
const wrap = new Uint8Array(32).fill(7);

const device = (id: string, over: Partial<Device> = {}): Device => ({
  id, name: id.slice(-2), platform: "web", state: "trusted", signing_key: "k", agreement_key: "k", created_at: "2026-11-07T10:00:00Z", approved_by: null, approval_signature: null, current: false, ...over,
});
const list = (devices: Device[], removals: DeviceList["removals"] = []): DeviceList => ({ devices, removals });
const B = "00000000-0000-4000-8000-0000000000b1";
const C = "00000000-0000-4000-8000-0000000000c1";

async function setup() {
  const keys = createMemoryKeyStore();
  await keys.saveKeys(crypto.deviceKeys.create().export(wrap));
  await keys.saveIdentity({ accountId: session.accountId, deviceId: session.deviceId });
  /** A new host over the same stored state: what another page load or tab sees. */
  const host = (): EngineHost => createEngineHost({ keys, crypto: () => crypto, wrapSecret: async () => wrap.slice(), now: () => 0 });
  return { keys, host };
}

describe("the engine's saved state", () => {
  it("is stored sealed: nothing readable, and not openable with another secret", async () => {
    const { keys, host } = await setup();
    await host().run(session, (e) => e.verifyDevices(list([device(ME, { current: true })])));
    const sealed = (await keys.loadSnapshot())!;
    expect(new TextDecoder().decode(sealed)).not.toContain(session.accountId);
    expect(new TextDecoder().decode(sealed)).not.toContain(ME);
    const other = new Uint8Array(32).fill(9);
    const opened = crypto.deviceKeys.import((await keys.loadKeys())!, wrap);
    expect(() => crypto.engine.restore(opened, sealed, other, 0)).toThrow(/open_failed/);
  });

  it("a fresh device trusts only itself; a device it linked by an approval stays trusted after a reload", async () => {
    const { host } = await setup();
    const own = device(ME, { current: true });
    expect(await host().run(session, (e) => e.verifyDevices(list([own, device(B)])))).toEqual([ME]);
    await host().run(session, (e) => e.verifyDevices(list([own, device(B, { approved_by: ME, approval_signature: "s" })])));
    // A new page load, and the list no longer shows how B was approved: B is still known.
    expect(await host().run(session, (e) => e.verifyDevices(list([own, device(B)])))).toEqual([ME, B]);
  });

  it("the removal sequence survives a reload and only goes up", async () => {
    const { host } = await setup();
    const removal = { device_id: C, signing_key: "k", agreement_key: "k", removed_by: ME, sequence: 3, signature: "s" };
    await host().run(session, (e) => e.verifyDevices(list([device(ME, { current: true })], [removal])));
    // The server stops listing it; the next page still signs above it.
    expect(await host().run(session, (e) => e.signRemoval(device(B)).sequence)).toBe(4);
    // A lower sequence in a later list never lowers it.
    await host().run(session, (e) => e.verifyDevices(list([device(ME, { current: true })], [{ ...removal, sequence: 1 }])));
    expect(await host().run(session, (e) => e.signRemoval(device(B)).sequence)).toBe(4);
  });

  it("two tabs take turns and do not overwrite each other's pins", async () => {
    const { host } = await setup();
    const tabOne = host();
    const tabTwo = host();
    const own = device(ME, { current: true });
    await Promise.all([
      tabOne.run(session, async (e) => {
        await new Promise((r) => setTimeout(r, 10)); // slow, so the other tab would overlap if it could
        e.verifyDevices(list([own, device(B, { approved_by: ME, approval_signature: "s" })]));
      }),
      tabTwo.run(session, (e) => void e.verifyDevices(list([own, device(C, { approved_by: ME, approval_signature: "s" })]))),
    ]);
    // Neither list says anything now, so this is what is remembered.
    expect((await host().run(session, (e) => e.verifyDevices(list([own, device(B), device(C)])))).sort()).toEqual([ME, B, C].sort());
  });


  async function withTrusted() {
    const t = await setup();
    const own = device(ME, { current: true });
    await t.host().run(session, (e) => e.verifyDevices(list([own, device(B, { approved_by: ME, approval_signature: "s" })])));
    return { ...t, own };
  }

  it("a snapshot these keys can't open is quarantined, dropped, and the person is told", async () => {
    const { keys, host, own } = await withTrusted();
    const stranger = fakeSeal(new Uint8Array(32).fill(9), "snapshot", new TextEncoder().encode("{}"));
    await keys.saveSnapshot(stranger);
    const h = host();
    expect(await h.run(session, (e) => e.verifyDevices(list([own, device(B)])))).toEqual([ME]); // starts from itself
    expect(await keys.loadQuarantine()).toEqual([stranger]); // the blob is kept
    expect(h.notice.get()).toBe(SNAPSHOT_UNREADABLE);
    // The live copy is the fresh engine's, sealed; the unreadable one is not it.
    expect(await keys.loadSnapshot()).not.toEqual(stranger);
  });

  it("a snapshot in a format this version doesn't read is quarantined too, and kept", async () => {
    const { keys, host, own } = await withTrusted();
    const odd = fakeSeal(wrap, "snapshot", new TextEncoder().encode("not json"));
    await keys.saveSnapshot(odd);
    const h = host();
    expect(await h.run(session, (e) => e.verifyDevices(list([own, device(B)])))).toEqual([ME]);
    expect(await keys.loadQuarantine()).toEqual([odd]);
    expect(h.notice.get()).toBe(SNAPSHOT_UNREADABLE);
    h.notice.clear();
    expect(h.notice.get()).toBeNull();
  });

  it("keeps at most three unreadable snapshots: the first, pinned, and the newest after it", async () => {
    const { keys } = await setup();
    for (let i = 1; i <= QUARANTINE_KEEP + 2; i++) await keys.quarantineSnapshot(new Uint8Array([i]));
    expect((await keys.loadQuarantine()).map((b) => b[0])).toEqual([1, 4, 5]);
    await keys.quarantineSnapshot(new Uint8Array([5])); // the same again adds nothing
    expect((await keys.loadQuarantine()).map((b) => b[0])).toEqual([1, 4, 5]);
  });

  it("state made for another account or device is not used, but it is quarantined, not dropped", async () => {
    const { keys, host, own } = await withTrusted();
    const made = (await keys.loadSnapshot())!;
    for (const other of [{ accountId: "00000000-0000-4000-8000-0000000000ff", deviceId: ME }, { accountId: session.accountId, deviceId: "00000000-0000-4000-8000-0000000000fe" }]) {
      await keys.saveIdentity(other);
      const h = host();
      expect(await h.run(session, (e) => e.verifyDevices(list([own, device(B)])))).toEqual([ME]);
      expect(h.notice.get()).toBe(SNAPSHOT_UNREADABLE);
      expect(await keys.loadIdentity()).toEqual({ accountId: session.accountId, deviceId: session.deviceId });
      await h.run(session, (e) => e.verifyDevices(list([own, device(B, { approved_by: ME, approval_signature: "s" })]))); // trusts B again
    }
    expect((await keys.loadQuarantine())[0]).toEqual(made); // the original is what was pinned first
  });

  it("the notice shows whenever something is quarantined: after a reload, and in other tabs; dismissing hides it for the page", async () => {
    const { keys, host } = await setup();
    await keys.quarantineSnapshot(new Uint8Array([4, 4, 4]));
    const reloaded = host(); // a new page over the same store
    await reloaded.notice.refresh();
    expect(reloaded.notice.get()).toBe(SNAPSHOT_UNREADABLE);
    reloaded.notice.clear();
    expect(reloaded.notice.get()).toBeNull();
    // Another tab quarantines something: it tells this one.
    const other = host();
    await keys.saveSnapshot(fakeSeal(new Uint8Array(32).fill(9), "snapshot", new TextEncoder().encode("{}")));
    await other.run(session, () => 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(reloaded.notice.get()).toBe(SNAPSHOT_UNREADABLE);
  });

  it("a failed save fails the action, so nothing that depended on it is sent", async () => {
    const { keys, host } = await setup();
    const own = device(ME, { current: true });
    const real = keys.saveSnapshot;
    keys.saveSnapshot = async () => {
      throw new Error("quota exceeded");
    };
    await expect(host().run(session, (e) => e.signRemoval(device(B)))).rejects.toThrow(/quota/);
    // An action that failed itself reports its own error, not the save's.
    await expect(
      host().run(session, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    keys.saveSnapshot = real;
    expect(await host().run(session, (e) => e.verifyDevices(list([own])))).toEqual([ME]);
  });

  it("forgetting waits for an action in progress, and an action after it cannot make a new wrapping secret", async () => {
    const { keys } = await setup();
    let secrets = 0;
    const h = createEngineHost({ keys, crypto: () => crypto, wrapSecret: async () => (secrets++, wrap.slice()), now: () => 0 });
    let release!: () => void;
    const slow = h.run(session, () => new Promise<void>((r) => (release = r)));
    const forgot = h.forget();
    await new Promise((r) => setTimeout(r, 20));
    expect(await keys.loadKeys()).not.toBeNull(); // not forgotten while the action runs
    release();
    await slow;
    await forgot;
    expect(await keys.loadKeys()).toBeNull();
    expect(await keys.loadSnapshot()).toBeNull(); // the action's own save came before the forgetting
    const before = secrets;
    await expect(h.run(session, () => 1)).rejects.toThrow(/no keys/);
    expect(secrets).toBe(before); // no wrapping key was asked for
  });

  it("zeroes the wrapping secret after use", async () => {
    const { keys } = await setup();
    let given!: Uint8Array;
    const h = createEngineHost({ keys, crypto: () => crypto, wrapSecret: async () => (given = wrap.slice()), now: () => 0 });
    await h.run(session, (e) => e.verifyDevices(list([])));
    expect([...given].every((b) => b === 0)).toBe(true);
  });
});
