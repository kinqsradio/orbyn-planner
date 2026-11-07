import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure } from "../../api/auth";
import { useAuth } from "../../auth/AuthProvider";
import { confirmTotp, disableTotp, enrolTotp } from "../../auth/flows";
import { saveFile } from "../export/save";
import { Modal } from "../../components/Modal";
import { describeError } from "./AuthScreens";
import { QrCode } from "./QrCode";

const groupSecret = (secret: string) => secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
const digits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

/** The one text file of recovery codes. */
export const recoveryFile = (codes: readonly string[]) =>
  `Orbyn Planner recovery codes\n\nEach code works once, in place of a code from your authenticator app. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;

function CodesStep({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setNote("Copied.");
    } catch {
      setNote("Couldn’t copy. Select the codes and copy them, or download them.");
    }
  };
  const download = async () => {
    try {
      setNote((await saveFile("orbyn-recovery-codes.txt", "text/plain", recoveryFile(codes))) ? "Saved." : null);
    } catch {
      setNote("Couldn’t save the file. Copy the codes instead.");
    }
  };
  return (
    <>
      <b className="card-title">Save your recovery codes</b>
      <p className="t3 small">If you lose your authenticator app, each of these signs you in once. They are shown only now.</p>
      <ul className="card mono" aria-label="Recovery codes" style={{ listStyle: "none", margin: 0, columns: 2, gap: 6, padding: "10px 14px" }}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="dialog-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
        <button type="button" className="ghost" onClick={() => void copy()}>Copy</button>
        <button type="button" className="ghost" onClick={() => void download()}>Download .txt</button>
      </div>
      {note && <p className="t3 small" role="status">{note}</p>}
      <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I’ve saved these codes
      </label>
      <div className="dialog-actions">
        <button type="button" className="btn" disabled={!saved} onClick={onDone}>Done</button>
      </div>
    </>
  );
}

function EnrolDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const auth = useAuth()!;
  const [enrolment, setEnrolment] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setEnrolment(await enrolTotp(auth.services, auth.session!));
      setStarted(true);
    } catch (e) {
      // The engine says it is already on: the row is out of date, so it is refreshed.
      if (e instanceof ApiFailure && e.code === "totp_already_enabled") onDone();
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const done = await confirmTotp(auth.services, auth.session!, digits(code));
      setCodes(done.recovery_codes);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal label="Turn on two-factor" onClose={codes ? () => undefined : onClose}>
      {codes ? (
        <CodesStep codes={codes} onDone={onDone} />
      ) : !started ? (
        <>
          <b className="card-title">Turn on two-factor</b>
          <p className="t3 small">Signing in on a new device will ask for a six-digit code from an authenticator app, as well as your password. You’ll need an app such as Google Authenticator, 1Password or Authy.</p>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="btn" data-autofocus disabled={busy} onClick={() => void start()}>Continue</button>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => void confirm(e)} aria-label="Confirm two-factor">
          <b className="card-title">Scan this with your authenticator app</b>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", margin: "10px 0" }}>
            <QrCode value={enrolment!.uri} label="QR code for your authenticator app" />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <span className="t3 small">Or type this key into the app:</span>
              <code className="mono" aria-label="Secret key" style={{ wordBreak: "break-all" }}>{groupSecret(enrolment!.secret)}</code>
              <span className="t3 small">It is shown only now.</span>
            </div>
          </div>
          <div className="form" style={{ width: "auto" }}>
            <label htmlFor="tf-code">Code from the app</label>
            <input id="tf-code" className="field" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} data-autofocus />
          </div>
          {error && <p className="err" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={busy || digits(code).length !== 6}>Turn on</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function DisableDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const auth = useAuth()!;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // This device's own signature is the proof: no code, so a lost authenticator can't lock anyone out of turning it off.
      await disableTotp(auth.services, auth.session!);
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "totp_not_enabled") onDone();
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Modal label="Turn off two-factor" onClose={onClose}>
      <b className="card-title">Turn off two-factor?</b>
      <p className="t3 small">New devices will sign in with just your password. This device proves it’s yours, so you don’t need a code. Your recovery codes stop working.</p>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="ghost" data-autofocus onClick={onClose}>Cancel</button>
        <button type="button" className="btn" disabled={busy} onClick={() => void submit()}>Turn off</button>
      </div>
    </Modal>
  );
}

/** Settings · Account · Two-factor: the row, and the dialogs to turn it on (QR code, then recovery codes) and off. The state is the engine's (`totp_enabled`). */
export function TwoFactorRow() {
  const auth = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  const [dialog, setDialog] = useState<"on" | "off" | null>(null);
  const services = auth?.services;
  const signedIn = Boolean(auth?.session);

  /** Bumped when a dialog finishes, so the state is read from the engine again. */
  const [reads, setReads] = useState(0);

  useEffect(() => {
    if (!signedIn || !services) return;
    let live = true;
    // Not known now (offline, say): the row says so rather than guessing.
    void services.api.currentDevice().then(
      (d) => live && setOn(d.totp_enabled),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [signedIn, services, reads]);

  if (!auth?.session) return null;
  const done = () => {
    setDialog(null);
    setReads((n) => n + 1);
  };
  return (
    <>
      <div className="kv" style={{ height: 44, borderTop: "1px solid var(--line)" }}>
        <span>Two-factor</span>
        <b className="ctl">
          <span className="t3">{on === null ? "…" : on ? "On" : "Off"}</span>
          <button type="button" className="ghost" disabled={on === null} onClick={() => setDialog(on ? "off" : "on")}>{on ? "Turn off…" : "Turn on…"}</button>
        </b>
      </div>
      {dialog === "on" && <EnrolDialog onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "off" && <DisableDialog onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}
