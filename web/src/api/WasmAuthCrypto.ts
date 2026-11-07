import type { ApprovalNonce } from "../generated/ApprovalNonce";
import type { ConfirmApproval } from "../generated/ConfirmApproval";
import type { CreateApproval } from "../generated/CreateApproval";
import type { PendingApproval } from "../generated/PendingApproval";
import type { ProtectionLevel } from "../generated/ProtectionLevel";
import type { SetProtection } from "../generated/SetProtection";
import type { RemoveDevice } from "../generated/RemoveDevice";
import type { ApprovalEngine, ApproverPairing, AuthCrypto, DeviceKeys, DevicePairing, PendingLogin, PendingRegistration, ProtectionView } from "./authCrypto";

/** `ApproverSession` in orbyn-wasm. */
export interface WasmApproverSession {
  free(): void;
  readonly createJson: string;
  deviceFingerprint(): string;
  reveal(viewJson: string): string;
  sas(): string | undefined;
}
/** `DeviceSession` in orbyn-wasm. */
export interface WasmDeviceSession {
  free(): void;
  readonly nonceJson: string;
  sas(viewJson: string): string;
}
/** `SyncEngine` in orbyn-wasm, as far as approving a device needs it. Data goes in and out as JSON. */
export interface WasmSyncEngine {
  free(): void;
  tick(now: number): string;
  tickAt(editAt: number, now: number): string;
  skippedFutureStamps(): number;
  tokenExpired(zone: string): void;
  applyChangesFrom(zone: string, since: string | undefined, pageJson: string, now: number): string;
  quarantined(zone: string): string;
  stage(zone: string, recordType: string, recordId: string, fieldsJson: string): void;
  delete(zone: string, recordId: string): void;
  buildUpload(zone: string): string | undefined;
  uploadSucceeded(zone: string, resultJson: string): void;
  uploadConflicted(zone: string, conflictJson: string, now: number): string;
  abandonUpload(zone: string): void;
  applyChanges(zone: string, pageJson: string, now: number): string;
  token(zone: string): string | undefined;
  record(zone: string, recordId: string): string | undefined;
  checkZones(zonesJson: string): string;
  createZoneKey(zone: string): string;
  envelopesFor(zone: string, devicesJson: string): string;
  acceptEnvelopes(envelopesJson: string, devicesJson: string): string;
  retryQuarantined(zone: string, now: number): string;
  trash(zone: string): string;
  takeFromTrash(zone: string, recordId: string): string | undefined;
  deleteZoneProof(zone: string): string;
  pinDevice(deviceId: string, signingKey: string, agreementKey: string): void;
  verifyDevices(devicesJson: string): string;
  signRemoval(deviceJson: string): string;
  signProtection(level: string, nowSecs: number): string;
  resignProtection(level: string, headJson: string, nowSecs: number): string;
  verifyProtection(chainJson: string, devicesJson: string): string;
  protectionFrom(): number;
  protectionLevel(): string;
  protectionSeq(): number;
  snapshot(wrapSecret: Uint8Array): Uint8Array;
  startApproval(deviceJson: string, nowSecs: number): WasmApproverSession;
  confirmApproval(session: WasmApproverSession, devicesJson: string): string;
  joinApproval(viewJson: string, nowSecs: number): WasmDeviceSession;
  finishApproval(session: WasmDeviceSession, viewJson: string, typed: string | undefined, nowSecs: number): string;
}

/**
 * The shape of the module `wasm-bindgen --target web` makes from the engine's orbyn-wasm crate
 * (`pkg/orbyn_wasm.js`), as far as sign-in needs it. Its functions are the ones in AuthCrypto.
 */
export interface OrbynWasmModule {
  /** The initialiser wasm-bindgen exports; it fetches and compiles the `.wasm` file. */
  default?: (...args: never[]) => Promise<unknown>;
  startRegistration(password: Uint8Array): PendingRegistration;
  finishRegistration(pending: PendingRegistration, password: Uint8Array, response: Uint8Array): Uint8Array;
  startLogin(password: Uint8Array): PendingLogin;
  finishLogin(pending: PendingLogin, password: Uint8Array, response: Uint8Array): Uint8Array;
  DeviceKeys: {
    create(): DeviceKeys;
    import(sealed: Uint8Array, wrapSecret: Uint8Array): DeviceKeys;
  };
  SyncEngine: {
    create(keys: DeviceKeys, accountId: string, deviceId: string): WasmSyncEngine;
    restore(keys: DeviceKeys, sealed: Uint8Array, wrapSecret: Uint8Array, nowMillis: number): WasmSyncEngine;
  };
  normalizeEmail(email: string): string | undefined;
}

/** The approval functions over a loaded module: typed objects in, the module's JSON strings underneath. */
/**
 * A session is its own object in the module, independent of the engine that made it, so it can be
 * used with another engine restored from the same snapshot.
 */
const sessions = new WeakMap<object, WasmApproverSession | WasmDeviceSession>();

function wasmApprovals(engine: WasmSyncEngine): ApprovalEngine {
  const approver = (s: ApproverPairing) => sessions.get(s) as WasmApproverSession;
  const device = (s: DevicePairing) => sessions.get(s) as WasmDeviceSession;
  return {
    sync: {
      tick: (now) => engine.tick(now),
      tickAt: (editAt, now) => engine.tickAt(editAt, now),
      skippedFutureStamps: () => engine.skippedFutureStamps(),
      tokenExpired: (zone) => engine.tokenExpired(zone),
      applyChangesFrom: (zone, since, page, now) => engine.applyChangesFrom(zone, since, page, now),
      quarantined: (zone) => engine.quarantined(zone),
      stage: (zone, type, id, fields) => engine.stage(zone, type, id, fields),
      delete: (zone, id) => engine.delete(zone, id),
      buildUpload: (zone) => engine.buildUpload(zone) ?? undefined,
      uploadSucceeded: (zone, result) => engine.uploadSucceeded(zone, result),
      uploadConflicted: (zone, conflict, now) => engine.uploadConflicted(zone, conflict, now),
      abandonUpload: (zone) => engine.abandonUpload(zone),
      applyChanges: (zone, page, now) => engine.applyChanges(zone, page, now),
      token: (zone) => engine.token(zone) ?? undefined,
      record: (zone, id) => engine.record(zone, id) ?? undefined,
      checkZones: (zones) => engine.checkZones(zones),
      createZoneKey: (zone) => engine.createZoneKey(zone),
      envelopesFor: (zone, devices) => engine.envelopesFor(zone, devices),
      acceptEnvelopes: (envelopes, devices) => engine.acceptEnvelopes(envelopes, devices),
      retryQuarantined: (zone, now) => engine.retryQuarantined(zone, now),
      trash: (zone) => engine.trash(zone),
      takeFromTrash: (zone, id) => engine.takeFromTrash(zone, id) ?? undefined,
      deleteZoneProof: (zone) => engine.deleteZoneProof(zone),
      pinDevice: (id, signing, agreement) => engine.pinDevice(id, signing, agreement),
    },
    free: () => engine.free(),
    snapshot: (wrapSecret) => engine.snapshot(wrapSecret),
    verifyDevices: (devices) => JSON.parse(engine.verifyDevices(JSON.stringify(devices))) as string[],
    signRemoval: (target) => JSON.parse(engine.signRemoval(JSON.stringify(target))) as RemoveDevice,
    protection: {
      sign: (level, nowSecs) => JSON.parse(engine.signProtection(level, nowSecs)) as SetProtection,
      resign: (level, head, nowSecs) => JSON.parse(engine.resignProtection(level, JSON.stringify(head), nowSecs)) as SetProtection,
      verify: (chain, devices) => JSON.parse(engine.verifyProtection(JSON.stringify(chain), JSON.stringify(devices))) as ProtectionView,
      from: () => engine.protectionFrom(),
      level: () => ({ ...(JSON.parse(engine.protectionLevel()) as { state: ProtectionView["state"]; level?: ProtectionLevel }), seq: engine.protectionSeq() }),
    },
    startApproval: (target, nowSecs) => {
      const inner = engine.startApproval(JSON.stringify(target), nowSecs);
      const pairing: ApproverPairing = {
        free: () => inner.free(),
        createRequest: JSON.parse(inner.createJson) as CreateApproval,
        deviceFingerprint: () => inner.deviceFingerprint(),
        reveal: (view: PendingApproval) => JSON.parse(inner.reveal(JSON.stringify(view))) as ApprovalNonce,
        sas: () => inner.sas() ?? undefined,
      };
      sessions.set(pairing, inner);
      return pairing;
    },
    confirmApproval: (session, devices) => JSON.parse(engine.confirmApproval(approver(session), JSON.stringify(devices))) as ConfirmApproval,
    joinApproval: (view, nowSecs) => {
      const inner = engine.joinApproval(JSON.stringify(view), nowSecs);
      const pairing: DevicePairing = {
        free: () => inner.free(),
        nonce: JSON.parse(inner.nonceJson) as ApprovalNonce,
        sas: (v: PendingApproval) => inner.sas(JSON.stringify(v)),
      };
      sessions.set(pairing, inner);
      return pairing;
    },
    finishApproval: (session, view, typed, nowSecs) => engine.finishApproval(device(session), JSON.stringify(view), typed, nowSecs),
  };
}

/** AuthCrypto over a loaded module: every call goes straight to the module's function of the same name. */
export function wasmAuthCrypto(module: OrbynWasmModule): AuthCrypto {
  return {
    startRegistration: (password) => module.startRegistration(password),
    finishRegistration: (pending, password, response) => module.finishRegistration(pending, password, response),
    startLogin: (password) => module.startLogin(password),
    finishLogin: (pending, password, response) => module.finishLogin(pending, password, response),
    deviceKeys: {
      create: () => module.DeviceKeys.create(),
      import: (sealed, wrapSecret) => module.DeviceKeys.import(sealed, wrapSecret),
    },
    engine: {
      create: (keys, accountId, deviceId) => wasmApprovals(module.SyncEngine.create(keys, accountId, deviceId)),
      restore: (keys, sealed, wrapSecret, nowMillis) => wasmApprovals(module.SyncEngine.restore(keys, sealed, wrapSecret, nowMillis)),
    },
    normalizeEmail: (email) => module.normalizeEmail(email),
  };
}

/**
 * Loads the module with the given loader and wraps it. Nothing calls this yet: the build has no
 * WebAssembly step. When it does, the entry point registers it with a dynamic import:
 *
 *     registerAuthCrypto(await loadWasmAuthCrypto(() => import("orbyn-wasm")));
 */
export async function loadWasmAuthCrypto(load: () => Promise<OrbynWasmModule>): Promise<AuthCrypto> {
  const module = await load();
  await module.default?.();
  return wasmAuthCrypto(module);
}
