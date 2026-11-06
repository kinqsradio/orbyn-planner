import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure } from "../../api/auth";
import { authCryptoAvailable, SIGN_IN_UNAVAILABLE } from "../../api/authCrypto";
import { Icon } from "../../components/Icon";
import { Portal } from "../../components/Portal";
import { useDialog } from "../../components/useDialog";
import type { ApprovalCreated } from "../../generated/ApprovalCreated";
import type { Device } from "../../generated/Device";
import { useAuth } from "../../auth/AuthProvider";
import { approveDevice } from "../../auth/flows";
import { describeError } from "./AuthScreens";

const PLATFORMS: Record<Device["platform"], string> = { web: "Web", ios: "iPhone or iPad", android: "Android", macos: "Mac", windows: "Windows", linux: "Linux" };

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "418207" as "418 207", the way it is read out. */
export const groupCode = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code);

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  return (
    <Portal>
      <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} className="authcard" style={{ width: 440 }} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
          {children}
        </div>
      </div>
    </Portal>
  );
}

/** A trusted device's side of adding a device: say what is asking, then sign the approval and show the code. */
function ApproveDialog({ device, onClose, onDone }: { device: Device; onClose: () => void; onDone: () => void }) {
  const auth = useAuth()!;
  const [approval, setApproval] = useState<ApprovalCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allow = async () => {
    setBusy(true);
    setError(null);
    try {
      setApproval(await approveDevice(auth.services, auth.session!, device));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal label="New sign-in" onClose={onClose}>
      <b className="card-title">New sign-in</b>
      <div className="kv"><span>Device</span><b>{device.name}</b></div>
      <div className="kv"><span>Kind</span><b>{PLATFORMS[device.platform]}</b></div>
      <div className="kv"><span>When</span><b>{when(device.created_at)}</b></div>
      {approval ? (
        <>
          <p className="t3 small">Type this code on {device.name}. It works for ten minutes, with five tries.</p>
          <span className="mono code" data-testid="approval-code" aria-label={`Code ${approval.code.split("").join(" ")}`}>{groupCode(approval.code)}</span>
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onDone}>Done</button>
          </div>
        </>
      ) : (
        <>
          <p className="t3 small">If this was you, allow it and type the code that appears on the new device.</p>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={onClose}>Don’t allow</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void allow()}>{busy ? "Allowing…" : "Allow"}</button>
          </div>
        </>
      )}
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
      await auth.services.api.removeDevice(device.id);
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
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="ghost danger" disabled={busy} onClick={() => void remove()}>Remove</button>
      </div>
    </Modal>
  );
}

function AddDeviceDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal label="Add a device" onClose={onClose}>
      <b className="card-title">Add a device</b>
      <ol className="steps">
        <li>On the new device, open Orbyn Planner and sign in with your email and password.</li>
        <li>It will say it is waiting for approval. Come back here and choose Approve next to it.</li>
        <li>Type the 6-digit code that appears here on the new device.</li>
      </ol>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function SignedInAccount() {
  const auth = useAuth()!;
  const { session, services } = auth;
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<Device | null>(null);
  const [removing, setRemoving] = useState<Device | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(
    () =>
      services.api.devices().then(
        (list) => {
          setDevices(list.devices);
          setError(null);
        },
        (e: unknown) => {
          // A 401 has signed this device out already, and this screen is going away.
          if (!(e instanceof ApiFailure && e.status === 401)) setError(describeError(e));
        },
      ),
    [services],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="card" style={{ gap: 0, padding: "0 14px" }}>
        <div className="kv" style={{ height: 44, borderBottom: "1px solid var(--line)" }}><span>Name</span><b>{session?.name || "Not set"}</b></div>
        <div className="kv" style={{ height: 44 }}><span>Email</span><b>{session?.email}</b></div>
      </div>

      <div className="bh"><b>Devices</b><span>{devices?.length ?? ""}</span></div>
      {error && <p className="err" role="alert">{error}</p>}
      <ul className="card" style={{ gap: 0, padding: "0 14px" }} aria-label="Devices">
        {(devices ?? []).map((d, i, all) => (
          <li key={d.id} className="kv device-row" style={{ minHeight: 44, borderBottom: i < all.length - 1 ? "1px solid var(--line)" : undefined }}>
            <span>
              {d.name}
              {d.current && <span className="t3"> · this device</span>}
            </span>
            <b className="ctl">
              {d.state === "pending" ? <span className="amber-text">Waiting for approval</span> : <span className="t3">Added {when(d.created_at)}</span>}
              {d.state === "pending" && session?.deviceState === "trusted" && (
                <button type="button" className="ghost" aria-label={`Approve ${d.name}`} onClick={() => setApproving(d)}>Approve</button>
              )}
              {!d.current && (
                <button type="button" className="ghost" aria-label={`Remove ${d.name}`} onClick={() => setRemoving(d)}>Remove</button>
              )}
            </b>
          </li>
        ))}
      </ul>
      <div className="account-actions">
        <button type="button" className="ghost" onClick={() => void auth.signOut()}>Sign out</button>
        <button type="button" className="ghost" onClick={() => void load()}>Refresh</button>
        <button type="button" className="ghost" onClick={() => setAdding(true)}>
          <Icon name="plus" small />
          Add a device
        </button>
      </div>

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
      <div className="card" style={{ gap: 6 }}>
        <b style={{ fontWeight: 500 }}>This device only</b>
        <span className="t3">Your planner is saved on this device. An account keeps it on your other devices too.</span>
        {!authCryptoAvailable() && <span className="t3 small">{SIGN_IN_UNAVAILABLE}.</span>}
      </div>
      <div className="account-actions">
        <button type="button" className="ghost" onClick={() => auth.openAuth("signup")}>Create an account</button>
        <button type="button" className="btn" onClick={() => auth.openAuth("signin")}>Sign in</button>
      </div>
    </>
  );
}
