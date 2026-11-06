import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeBytes } from "../api/bytes";
import { createMemoryKeyStore } from "../api/keyStore";
import { FakeAuthCrypto } from "../api/testing/FakeAuthCrypto";
import { createMockEngine } from "../api/testing/MockEngine";
import type { Device } from "../generated/Device";
import type { PendingApproval } from "../generated/PendingApproval";
import { DeviceController, delays } from "./pairing";
import { createAuthServices, DEFAULT_POLL } from "./services";

afterEach(() => vi.useRealTimers());

describe("polling", () => {
  it("backs off from 2 s to 10 s", () => {
    const seq: number[] = [];
    for (const d of delays(DEFAULT_POLL)) {
      seq.push(d);
      if (seq.length === 8) break;
    }
    expect(seq).toEqual([2000, 3000, 4500, 6750, 10000, 10000, 10000, 10000]);
  });

  it("a waiting device asks about every 2 s at first, then every 10 s, and stops when disposed", async () => {
    vi.useFakeTimers();
    const engine = createMockEngine();
    const crypto = new FakeAuthCrypto();
    const keys = createMemoryKeyStore();
    const services = createAuthServices({ fetch: engine.fetch, baseUrl: "http://e.test", keys, crypto: () => crypto });
    // A pending device with a session on the mock server.
    const account = { id: "00000000-0000-4000-8000-0000000000a1", email: "a@b.co", verifier: new Uint8Array(32), devices: [] as Device[] };
    const pendingDevice: Device = {
      id: "00000000-0000-4000-8000-0000000000d9", name: "X", platform: "web", state: "pending", signing_key: "k", agreement_key: "k",
      created_at: "2026-11-07T10:00:00Z", approved_by: null, approval_signature: null, current: true,
    };
    account.devices.push(pendingDevice);
    engine.accounts.set("a@b.co", account);
    engine.sessions.set("tok", { accountId: account.id, deviceId: pendingDevice.id });
    await keys.saveKeys(crypto.deviceKeys.create().export());
    await services.tokens.set({ token: "tok", accountId: account.id, deviceId: pendingDevice.id, deviceState: "pending", expiresAt: "2027-01-01T00:00:00Z", email: "a@b.co", name: "" });
    const controller = new DeviceController(services, services.tokens.getSession()!);
    void controller.run();
    await vi.advanceTimersByTimeAsync(60_000);
    const asks = engine.calls.filter((c) => c.path === "/v1/devices/current").length;
    // 0, 2, 5, 9.5, 16.25, 26.25, 36.25, 46.25, 56.25 seconds.
    expect(asks).toBe(9);
    controller.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.calls.filter((c) => c.path === "/v1/devices/current").length).toBe(asks);
  });
});

describe("the approval functions of the stand-in crypto", () => {
  const crypto = new FakeAuthCrypto();
  const accountId = "00000000-0000-4000-8000-0000000000a1";
  const approverKeys = crypto.deviceKeys.create();
  const deviceKeys = crypto.deviceKeys.create();
  const pending = (): Device => ({
    id: "00000000-0000-4000-8000-0000000000d1", name: "New", platform: "web", state: "pending", signing_key: deviceKeys.signingKey(),
    agreement_key: deviceKeys.agreementKey(), created_at: "2026-11-07T10:00:00Z", approved_by: null, approval_signature: null, current: false,
  });
  const approverEngine = crypto.approvals(approverKeys, accountId, "00000000-0000-4000-8000-0000000000a2");
  const deviceEngine = crypto.approvals(deviceKeys, accountId, pending().id);
  const NOW = 1_794_000_000;

  function viewFrom(a: ReturnType<typeof approverEngine.startApproval>, extra: Partial<PendingApproval> = {}): PendingApproval {
    return {
      id: a.createRequest.approval_id, expires_at: "", created_at: NOW, approver_id: "00000000-0000-4000-8000-0000000000a2",
      approver_signing_key: approverKeys.signingKey(), approver_agreement_key: approverKeys.agreementKey(), device_id: pending().id,
      device_signing_key: deviceKeys.signingKey(), device_agreement_key: deviceKeys.agreementKey(), commitment: a.createRequest.commitment,
      device_nonce: null, approver_nonce: null, signature: null, endorsement: null, ...extra,
    };
  }

  it("the same digits on both sides, and the approver reveals only after it has the new device's nonce", () => {
    const a = approverEngine.startApproval(pending(), NOW);
    expect(() => a.reveal(viewFrom(a))).toThrow(/out_of_order/);
    const d = deviceEngine.joinApproval(viewFrom(a), NOW);
    const nonce = a.reveal(viewFrom(a, { device_nonce: d.nonce.nonce }));
    expect(d.sas(viewFrom(a, { device_nonce: d.nonce.nonce, approver_nonce: nonce.nonce }))).toBe(a.sas());
  });

  it("keys the server swapped make the approver refuse, and a changed nonce fails the commitment", () => {
    const a = approverEngine.startApproval(pending(), NOW);
    const d = deviceEngine.joinApproval(viewFrom(a), NOW);
    expect(() => a.reveal(viewFrom(a, { device_nonce: d.nonce.nonce, device_signing_key: approverKeys.signingKey() }))).toThrow(/keys_changed/);
    const nonce = a.reveal(viewFrom(a, { device_nonce: d.nonce.nonce }));
    const forged = encodeBytes(new Uint8Array(32).fill(9));
    expect(forged).not.toBe(nonce.nonce);
    expect(() => d.sas(viewFrom(a, { approver_nonce: forged }))).toThrow(/commitment_mismatch/);
  });

  it("the new device cannot finish before the approver confirmed, nor with wrong typed digits, nor twice", () => {
    const a = approverEngine.startApproval(pending(), NOW);
    const d = deviceEngine.joinApproval(viewFrom(a), NOW);
    const nonce = a.reveal(viewFrom(a, { device_nonce: d.nonce.nonce }));
    const base = viewFrom(a, { device_nonce: d.nonce.nonce, approver_nonce: nonce.nonce });
    expect(() => deviceEngine.finishApproval(d, base, undefined, NOW)).toThrow(/not_confirmed/);
    const confirm = approverEngine.confirmApproval(a, { devices: [], removals: [] });
    const confirmed = { ...base, signature: confirm.signature, endorsement: confirm.endorsement ?? null };
    expect(() => deviceEngine.finishApproval(d, confirmed, "000000", NOW)).toThrow(/wrong_code/);
    expect(() => deviceEngine.finishApproval(d, confirmed, undefined, NOW)).toThrow(/already_finished/); // one attempt
    expect(() => approverEngine.confirmApproval(a, { devices: [], removals: [] })).toThrow(/already_finished/);
  });

  it("an approval older than ten minutes is refused on joining", () => {
    const a = approverEngine.startApproval(pending(), NOW);
    expect(() => deviceEngine.joinApproval(viewFrom(a), NOW + 601)).toThrow(/approval_expired/);
  });
});
