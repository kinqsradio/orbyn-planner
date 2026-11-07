import { useSyncState } from "../../sync/SyncProvider";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ApiFailure } from "../../api/auth";
import { authCryptoAvailable, SIGN_IN_UNAVAILABLE } from "../../api/authCrypto";
import { cryptoLoad } from "../../api/realCrypto";
import { CryptoProblem } from "./CryptoProblem";
import { SyncSettings } from "../settings/SyncSettings";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { TwoFactorRow } from "./TwoFactor";
import type { Device } from "../../generated/Device";
import { useAuth } from "../../auth/AuthProvider";
import { removeDevice, verifiedDevices } from "../../auth/flows";
import { ApproverController } from "../../auth/pairing";
import { describeError } from "./AuthScreens";

export const PLATFORMS: Record<Device["platform"], string> = { web: "Web", ios: "iPhone or iPad", android: "Android", macos: "Mac", windows: "Windows", linux: "Linux" };

export function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "418207" as "418 207", the way it is read out. */
export const groupCode = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code);


/** The digits and the device's key fingerprint, side by side with the choice: nothing is approved until "They match". */
export function ApproveDialog({ device, onClose, onDone }: { device: Device; onClose: () => void; onDone: () => void }) {
  const auth = useAuth()!;
  const { services } = auth;
  const [attempt, setAttempt] = useState(0);
  const controller = useMemo(() => {
    void attempt; // a new attempt is a new approval
    return new ApproverController(services, auth.session!, device);
  }, [services, auth.session, device, attempt]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);

  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);

  const close = () => {
    // Leaving before it is done closes the approval; a finished or closed one just goes.
    if (state.phase !== "done" && state.phase !== "closed") void controller.cancel();
    onClose();
  };

  return (
    <Modal label="New sign-in" onClose={close}>
      <b className="card-title">New sign-in</b>
      {device.state !== "pending" && <p className="t3 small">{device.name} is signed in, but this device doesn’t trust it (it may have been approved under a device that was removed). Approve it again to trust it.</p>}
      <div className="kv"><span>Device</span><b>{device.name}</b></div>
      <div className="kv"><span>Kind</span><b>{PLATFORMS[device.platform]}</b></div>
      <div className="kv"><span>When</span><b>{when(device.created_at)}</b></div>
      {(state.phase === "starting" || state.phase === "waiting") && (
        <>
          <p className="t3 small" role="status">Waiting for {device.name} to show its code…</p>
          <p className="t3 small">It appears once that device is open and signed in.</p>
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={() => void controller.cancel()}>Cancel</button>
          </div>
        </>
      )}
      {state.phase === "compare" && (
        <>
          <p className="t3 small">{device.name} should show the same 6 digits. Only if they are identical, choose They match.</p>
          <span className="mono code" data-testid="approval-code" aria-label={`Code ${state.sas.split("").join(" ")}`}>{groupCode(state.sas)}</span>
          <div className="kv"><span>Device key</span><b className="mono" data-testid="fingerprint">{state.fingerprint}</b></div>
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={() => void controller.cancel()}>Cancel</button>
            <button type="button" className="btn" onClick={() => void controller.confirm()}>They match</button>
          </div>
        </>
      )}
      {(state.phase === "confirming" || state.phase === "finishing") && (
        <>
          <p className="t3 small" role="status">Waiting for {device.name} to confirm…</p>
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={() => void controller.cancel()}>Cancel</button>
          </div>
        </>
      )}
      {state.phase === "done" && (
        <>
          <p className="t3 small" role="status">{device.name} is trusted.</p>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onDone}>Done</button>
          </div>
        </>
      )}
      {state.phase === "closed" && (
        <>
          <p className="err" role="alert">{state.message}</p>
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={onClose}>Close</button>
            <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Start again</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Known from the last pass: with one trusted device, nothing else holds the keys of what only it can open. */
export function OnlyDeviceNote() {
  const sync = useSyncState();
  if (!sync || sync.phase === "off" || sync.devices > 1) return null;
  return <p className="err" role="alert">This is your only trusted device. Removing its planner here can’t be undone: lists only this device can open will be lost.</p>;
}

/** Signing out asks what to do with this account's planner on this browser. Remove is the default. */
function SignOutDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth()!;
  const go = (removePlanner: boolean) => {
    onClose();
    void auth.signOut({ removePlanner });
  };
  return (
    <Modal label="Sign out" onClose={onClose}>
      <b className="card-title">Sign out</b>
      <p>Remove this account’s planner from this browser?</p>
      <p className="t3 small">Remove deletes its lists, tasks and any changes not yet sent from this browser; your other devices keep theirs. Keep leaves them here, and they open again only when this same account signs in. It stays on this browser unencrypted.</p>
      <OnlyDeviceNote />
      <div className="dialog-actions">
        <button type="button" className="ghost" data-autofocus onClick={onClose}>Cancel</button>
        <button type="button" className="ghost" onClick={() => go(false)}>Keep on this browser</button>
        <button type="button" className="danger" onClick={() => go(true)}>Remove</button>
      </div>
    </Modal>
  );
}

function RemoveDialog({ device, onClose, onDone }: { device: Device; onClose: () => void; onDone: () => void }) {
  const auth = useAuth()!;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeDevice(auth.services, auth.session!, device);
      onDone();
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Modal label="Remove device" onClose={onClose}>
      <b className="card-title">Remove “{device.name}”?</b>
      <p className="t3 small">It is signed out at once and can’t open your planner until you approve it again.</p>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="ghost" data-autofocus onClick={onClose}>Cancel</button>
        <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>Remove</button>
      </div>
    </Modal>
  );
}

/** The steps of adding a device, which Add a device and approving from a tab that can't keep its keys both show. */
export function AddDeviceSteps() {
  return (
    <ol className="steps">
      <li>On the new device, open Orbyn Planner and sign in with your email and password.</li>
      <li>It will say it is waiting for approval. Come back here and choose Approve next to it.</li>
      <li>Both devices show the same 6 digits. If they match, choose They match on each.</li>
    </ol>
  );
}

function AddDeviceDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="Add a device" onClose={onClose}>
      <b className="card-title">Add a device</b>
      <AddDeviceSteps />
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function EngineNotice() {
  const { services } = useAuth()!;
  const message = useSyncExternalStore(services.engine.notice.subscribe, services.engine.notice.get);
  // Read the store when this screen opens: the notice shows after a reload and for what another tab quarantined.
  useEffect(() => {
    void services.engine.notice.refresh();
  }, [services]);
  if (!message) return null;
  return (
    <div className="card" role="status" style={{ gap: "var(--sp-6)" }}>
      <span className="t3">{message}</span>
      <button type="button" className="ghost" onClick={() => services.engine.notice.clear()}>Dismiss</button>
    </div>
  );
}

function SignedInAccount() {
  const auth = useAuth()!;
  const { session, services } = auth;
  const [devices, setDevices] = useState<Device[] | null>(null);
  /** The devices this device itself verifies; null until known. Approving is offered from this, never from the server's `state`. */
  const [verified, setVerified] = useState<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<Device | null>(null);
  const [removing, setRemoving] = useState<Device | null>(null);
  const [adding, setAdding] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(
    () =>
      services.api.devices().then(
        (list) => {
          setDevices(list.devices);
          setError(null);
          if (session) void verifiedDevices(services, session, list).then(setVerified);
        },
        (e: unknown) => {
          // A 401 has signed this device out already, and this screen is going away.
          if (!(e instanceof ApiFailure && e.status === 401)) setError(describeError(e));
        },
      ),
    [services, session],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A device this one does not verify can be approved: a new one, or one the server lists as trusted
  // that this device no longer trusts (stranded by a removal, or approved before the two-way code).
  const needsApproval = (d: Device) => session?.deviceState === "trusted" && !d.current && verified !== null && !verified.has(d.id);

  return (
    <>
      <EngineNotice />
      <div className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }}>
        <div className="kv" style={{ height: "var(--sp-44)", borderBottom: "var(--bw) solid var(--line)" }}><span>Name</span><b>{session?.name || "Not set"}</b></div>
        <div className="kv" style={{ height: "var(--sp-44)" }}><span>Email</span><b>{session?.email}</b></div>
        <TwoFactorRow />
      </div>

      <div className="bh"><b>Devices</b><span>{devices?.length ?? ""}</span></div>
      {error && <p className="err" role="alert">{error}</p>}
      <ul className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }} aria-label="Devices">
        {(devices ?? []).map((d, i, all) => (
          <li key={d.id} className="kv device-row" style={{ minHeight: "var(--sp-44)", borderBottom: i < all.length - 1 ? "var(--bw) solid var(--line)" : undefined }}>
            <span>
              {d.name}
              {d.current && <span className="t3"> · this device</span>}
            </span>
            <b className="ctl">
              {d.state === "pending" ? (
                <span className="amber-text">Waiting for approval</span>
              ) : needsApproval(d) ? (
                <span className="amber-text">Needs approving again</span>
              ) : (
                <span className="t3">Added {when(d.created_at)}</span>
              )}
              {needsApproval(d) && (
                <button type="button" className="ghost" aria-label={d.state === "pending" ? `Approve ${d.name}` : `Approve ${d.name} again`} onClick={() => setApproving(d)}>
                  {d.state === "pending" ? "Approve" : "Approve again"}
                </button>
              )}
              {!d.current && (
                <button type="button" className="ghost" aria-label={`Remove ${d.name}`} onClick={() => setRemoving(d)}>Remove</button>
              )}
            </b>
          </li>
        ))}
      </ul>
      <SyncSettings />
      <div className="account-actions">
        <button type="button" className="ghost" onClick={() => setSigningOut(true)}>Sign out</button>
        <button type="button" className="ghost" onClick={() => void load()}>Refresh</button>
        <button type="button" className="ghost" onClick={() => setAdding(true)}>
          <Icon name="plus" small />
          Add a device
        </button>
      </div>

      {signingOut && <SignOutDialog onClose={() => setSigningOut(false)} />}
      {approving && (
        <ApproveDialog
          device={approving}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            void load();
          }}
        />
      )}
      {removing && (
        <RemoveDialog
          device={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            void load();
          }}
        />
      )}
      {adding && <AddDeviceDialog onClose={() => setAdding(false)} />}
    </>
  );
}

/** Settings · Account: who is signed in and which devices, or how to sign in. */
export function AccountSettings() {
  const auth = useAuth();
  if (!auth) return <p className="quiet">Accounts aren’t part of this build.</p>;
  if (auth.status === "signedIn") return <SignedInAccount />;
  return (
    <>
      <div className="card" style={{ gap: "var(--sp-6)" }}>
        <b style={{ fontWeight: "var(--fw-medium)" }}>This device only</b>
        <span className="t3">Your planner is saved on this device. An account keeps it on your other devices too.</span>
        {!authCryptoAvailable() && cryptoLoad.get() !== "failed" && <span className="t3 small">{SIGN_IN_UNAVAILABLE}.</span>}
        <CryptoProblem />
      </div>
      <div className="account-actions">
        <button type="button" className="ghost" onClick={() => auth.openAuth("signup")}>Create an account</button>
        <button type="button" className="btn" onClick={() => auth.openAuth("signin")}>Sign in</button>
      </div>
    </>
  );
}
