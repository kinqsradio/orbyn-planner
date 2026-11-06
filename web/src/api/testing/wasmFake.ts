import type { DeviceKeys } from "../authCrypto";
import type { OrbynWasmModule } from "../WasmAuthCrypto";

/** A stand-in for the orbyn-wasm module that only records which function was called (tests). */
export function WasmAuthCrypto_forTests(): { module: OrbynWasmModule; log: string[] } {
  const log: string[] = [];
  const keys = { signingKey: () => "signing" } as unknown as DeviceKeys;
  const module: OrbynWasmModule = {
    default: async () => void log.push("init"),
    startRegistration: () => (log.push("startRegistration"), { request: new Uint8Array() }),
    finishRegistration: () => (log.push("finishRegistration"), new Uint8Array()),
    startLogin: () => (log.push("startLogin"), { request: new Uint8Array() }),
    finishLogin: () => (log.push("finishLogin"), new Uint8Array()),
    DeviceKeys: { create: () => (log.push("DeviceKeys.create"), keys), import: () => (log.push("DeviceKeys.import"), keys) },
    SyncEngine: {
      create: () => {
        log.push("SyncEngine.create");
        return {
          startApproval: () => (log.push("startApproval"), { createJson: "{}", deviceFingerprint: () => "fp", reveal: () => (log.push("reveal"), '{"nonce":"n"}'), sas: () => "123456" }),
          confirmApproval: () => (log.push("confirmApproval"), '{"signature":"s"}'),
          joinApproval: () => (log.push("joinApproval"), { nonceJson: '{"nonce":"d"}', sas: () => "123456" }),
          finishApproval: () => (log.push("finishApproval"), "123456"),
        };
      },
    },
    normalizeEmail: (e) => (log.push("normalizeEmail"), e.trim().toLowerCase()),
  };
  return { module, log };
}
