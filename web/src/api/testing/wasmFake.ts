import type { DeviceKeys } from "../authCrypto";
import type { OrbynWasmModule } from "../WasmAuthCrypto";

/** A stand-in for the orbyn-wasm module that only records which function was called (tests). */
export function WasmAuthCrypto_forTests(): { module: OrbynWasmModule; log: string[] } {
  const log: string[] = [];
  const keys = { signingKey: () => "signing", free: () => void log.push("DeviceKeys.free") } as unknown as DeviceKeys;
  const engine = () => ({
    free: () => void log.push("SyncEngine.free"),
    snapshot: () => (log.push("snapshot"), new Uint8Array([1])),
    verifyDevices: () => (log.push("verifyDevices"), '["a"]'),
    signRemoval: () => (log.push("signRemoval"), '{"sequence":1,"signature":"s"}'),
    startApproval: () => (log.push("startApproval"), { free: () => void log.push("ApproverSession.free"), createJson: "{}", deviceFingerprint: () => "fp", reveal: () => (log.push("reveal"), '{"nonce":"n"}'), sas: () => "123456" }),
    confirmApproval: () => (log.push("confirmApproval"), '{"signature":"s"}'),
    joinApproval: () => (log.push("joinApproval"), { free: () => void log.push("DeviceSession.free"), nonceJson: '{"nonce":"d"}', sas: () => "123456" }),
    finishApproval: () => (log.push("finishApproval"), "123456"),
  });
  const module: OrbynWasmModule = {
    default: async () => void log.push("init"),
    startRegistration: () => (log.push("startRegistration"), { request: new Uint8Array() }),
    finishRegistration: () => (log.push("finishRegistration"), new Uint8Array()),
    startLogin: () => (log.push("startLogin"), { request: new Uint8Array() }),
    finishLogin: () => (log.push("finishLogin"), new Uint8Array()),
    DeviceKeys: { create: () => (log.push("DeviceKeys.create"), keys), import: () => (log.push("DeviceKeys.import"), keys) },
    SyncEngine: {
      create: () => (log.push("SyncEngine.create"), engine()),
      restore: () => (log.push("SyncEngine.restore"), engine()),
    },
    normalizeEmail: (e) => (log.push("normalizeEmail"), e.trim().toLowerCase()),
  };
  return { module, log };
}
