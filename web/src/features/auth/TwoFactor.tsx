import { useState, type FormEvent } from "react";
import { ApiFailure } from "../../api/auth";
import { useAuth } from "../../auth/AuthProvider";
import { saveFile } from "../export/save";
import { Modal } from "../../components/Modal";
import { describeError } from "./AuthScreens";
import { QrCode } from "./QrCode";
import { readTwoFactor, rememberTwoFactor } from "./twoFactorState";

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

function EnrolDialog({ accountId, onClose, onDone }: { accountId: string; onClose: () => void; onDone: () => void }) {
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
      setEnrolment(await auth.services.api.totpEnrol());
      setStarted(true);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "totp_already_enabled") {
        rememberTwoFactor(accountId, true);
        onDone();
      }
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
      const done = await auth.services.api.totpConfirm({ code: digits(code) });
      rememberTwoFactor(accountId, true);
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

function DisableDialog({ accountId, onClose, onDone }: { accountId: string; onClose: () => void; onDone: () => void }) {
  const auth = useAuth()!;
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.services.api.totpDisable(recovery ? { code: null, recovery_code: code.trim() } : { code: digits(code), recovery_code: null });
      rememberTwoFactor(accountId, false);
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "totp_not_enabled") {
        rememberTwoFactor(accountId, false);
        onDone();
      }
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Modal label="Turn off two-factor" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} aria-label="Turn off two-factor">
        <b className="card-title">Turn off two-factor</b>
        <p className="t3 small">{recovery ? "Enter one of your recovery codes." : "Enter the six-digit code from your authenticator app."}</p>
        <div className="form" style={{ width: "auto" }}>
          <label htmlFor="tf-off">{recovery ? "Recovery code" : "Code"}</label>
          <input
            id="tf-off"
            key={recovery ? "recovery" : "code"}
            className="field"
            inputMode={recovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            placeholder={recovery ? "XXXXX-XXXXX" : "123456"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-autofocus
          />
        </div>
        <button type="button" className="link-btn" onClick={() => { setRecovery(!recovery); setCode(""); setError(null); }}>
          {recovery ? "Use a code from the app" : "Use a recovery code"}
        </button>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={busy || (recovery ? code.trim().length < 5 : digits(code).length !== 6)}>Turn off</button>
        </div>
      </form>
    </Modal>
  );
}

/** Settings · Account · Two-factor: the row, and the dialogs to turn it on (QR code, then recovery codes) and off. */
export function TwoFactorRow() {
  const auth = useAuth();
  const accountId = auth?.session?.accountId ?? "";
  const [on, setOn] = useState(() => readTwoFactor(accountId));
  const [dialog, setDialog] = useState<"on" | "off" | null>(null);
  if (!auth?.session) return null;
  return (
    <>
      <div className="kv" style={{ height: 44, borderTop: "1px solid var(--line)" }}>
        <span>Two-factor</span>
        <b className="ctl">
          <span className="t3">{on ? "On" : "Off"}</span>
          <button type="button" className="ghost" onClick={() => setDialog(on ? "off" : "on")}>{on ? "Turn off…" : "Turn on…"}</button>
        </b>
      </div>
      {dialog === "on" && <EnrolDialog accountId={accountId} onClose={() => setDialog(null)} onDone={() => { setOn(readTwoFactor(accountId)); setDialog(null); }} />}
      {dialog === "off" && <DisableDialog accountId={accountId} onClose={() => setDialog(null)} onDone={() => { setOn(readTwoFactor(accountId)); setDialog(null); }} />}
    </>
  );
}
