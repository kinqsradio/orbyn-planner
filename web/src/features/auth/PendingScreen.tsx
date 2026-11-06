import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiFailure } from "../../api/auth";
import type { CurrentDevice } from "../../generated/CurrentDevice";
import { useAuth } from "../../auth/AuthProvider";
import { submitApprovalCode } from "../../auth/flows";
import { describeError } from "./AuthScreens";

/** How often a waiting device asks whether it has been approved. */
export const POLL_MS = 5000;

/** The device signed in but is not trusted yet: it waits for a trusted device, then takes the six-digit code. */
export function PendingScreen() {
  const auth = useAuth()!;
  const { services } = auth;
  const [current, setCurrent] = useState<CurrentDevice | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await services.api.currentDevice();
      setCurrent(next);
      if (next.device.state === "trusted") await services.tokens.update({ deviceState: "trusted" });
    } catch (e) {
      // A 401 has already signed this device out; other failures are shown by the next action.
      if (!(e instanceof ApiFailure && e.status === 401)) setError(describeError(e));
    }
  }, [services]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const approval = current?.approval ?? null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      await submitApprovalCode(services, approval.id, code);
    } catch (e) {
      setError(describeError(e));
      setLeft(e instanceof ApiFailure ? e.attemptsLeft : null);
      setCode("");
      if (e instanceof ApiFailure && (e.code === "approval_expired" || e.attemptsLeft === 0)) void refresh();
    } finally {
      setBusy(false);
    }
  };

  const digits = code.replace(/\D/g, "");

  return (
    <main className="public-page" id="content" tabIndex={-1}>
      <form className="authcard" onSubmit={submit} aria-label="Approve this device">
        <b className="auth-title">Approve this device</b>
        <p className="t3">
          {auth.session?.email} is already open on another device. Open Orbyn Planner there, choose Allow for “{current?.device.name ?? "this device"}”, and type the 6-digit code it shows.
        </p>
        {approval ? (
          <>
            <label htmlFor="approval-code">6-digit code</label>
            <input
              id="approval-code"
              className="field mono-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={7}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-describedby="approval-help"
            />
            <p id="approval-help" className="t3 small" role="status">
              {error ?? (left !== null ? `Attempts left: ${left}.` : "The code works for a few minutes, with five tries.")}
            </p>
            <button type="submit" className="btn" disabled={busy || digits.length !== 6}>{busy ? "Checking…" : "Continue"}</button>
          </>
        ) : (
          <>
            <p className="t3" role="status">{error ?? "Waiting for a trusted device to approve this one."}</p>
            <button type="button" className="ghost" onClick={() => void refresh()}>Check again</button>
          </>
        )}
        <button type="button" className="link-btn quiet-link" onClick={() => void auth.signOut()}>Sign out</button>
      </form>
    </main>
  );
}
