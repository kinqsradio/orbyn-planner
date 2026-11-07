import { useState } from "react";
import { cancelDeletionByMail } from "../../auth/flows";
import type { AuthServices } from "../../auth/services";
import { describeError } from "./AuthScreens";

/** The address of this page: the link in the deletion email opens it, with the token in the fragment. */
export const CANCEL_DELETION_PATH = "/cancel-deletion";

/** The token from the link's fragment, which is then taken off the address so it stays out of history and of anything that reads the URL. */
function takeToken(): string {
  const token = window.location.hash.replace(/^#/, "").trim();
  if (token) window.history.replaceState(null, "", window.location.pathname);
  return token;
}

/**
 * The page behind the cancel link in the deletion email. Opening it does nothing: a mail scanner or a link preview that fetches
 * the address changes no account. The token is sent, from this device, only when the person presses the button. Needs no sign-in.
 */
export function CancelDeletionPage({ services }: { services: AuthServices }) {
  const [token] = useState(takeToken);
  const [state, setState] = useState<"ready" | "busy" | "done">("ready");
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    setState("busy");
    setError(null);
    try {
      await cancelDeletionByMail(services, token);
      setState("done");
    } catch (e) {
      setError(describeError(e));
      setState("ready");
    }
  };

  return (
    <main className="public-page" id="content" tabIndex={-1}>
      <div className="authcard" role="group" aria-label="Cancel account deletion">
        {state === "done" ? (
          <>
            <h1 className="auth-title">Deletion cancelled</h1>
            <p className="t3">Your account stays as it is. Nothing was deleted.</p>
            <a className="btn" href="/">Open Orbyn</a>
          </>
        ) : token ? (
          <>
            <h1 className="auth-title">Cancel your account’s deletion?</h1>
            <p className="t3">Your account is scheduled to be deleted, with everything in it. Cancelling keeps it. This link works once.</p>
            {error && <p className="err" role="alert">{error}</p>}
            <button type="button" className="btn" disabled={state === "busy"} onClick={() => void cancel()}>{state === "busy" ? "Cancelling…" : "Cancel deletion"}</button>
            <a className="t3 small" href="/">Leave the account as it is</a>
          </>
        ) : (
          <>
            <h1 className="auth-title">This link is incomplete</h1>
            <p className="t3">Open the link from the email again. You can also cancel from Settings on a device you’re signed in on, or sign in and choose “cancel deletion”.</p>
            <a className="btn" href="/">Open Orbyn</a>
          </>
        )}
      </div>
    </main>
  );
}
