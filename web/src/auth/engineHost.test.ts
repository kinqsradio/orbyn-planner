import { describe, expect, it } from "vitest";
import type { StoredSession } from "../api/keyStore";
import { createMemoryKeyStore } from "../api/keyStore";
import { FakeAuthCrypto } from "../api/testing/FakeAuthCrypto";
import type { Device } from "../generated/Device";
import type { DeviceList } from "../generated/DeviceList";
import { createEngineHost, type EngineHost } from "./engineHost";

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
  /** A new host over the same stored state: what another page load or tab sees. */
  const host = (): EngineHost => createEngineHost({ keys, crypto: () => crypto, wrapSecret: async () => wrap, now: () => 0 });
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

  it("an unreadable snapshot is dropped and the device starts again from itself", async () => {
    const { keys, host } = await setup();
    await keys.saveSnapshot(new Uint8Array([1, 2, 3]));
    expect(await host().run(session, (e) => e.verifyDevices(list([device(ME, { current: true })])))).toEqual([ME]);
    expect((await keys.loadSnapshot())!.length).toBeGreaterThan(3); // replaced by a sealed one
  });
});
