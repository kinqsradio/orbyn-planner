import { useEffect, useRef, useState } from "react";
import { engineUrl } from "../../api/engine";
import { Icon } from "../../components/Icon";

/** The address of this page: the link in the deletion email opens it, with the token in the fragment. */
export const CANCEL_DELETION_PATH = "/cancel-deletion";

/**
 * This page is isolated on purpose: it needs no sign-in and touches no planner data, so it renders before the app shell and the
 * accounts layer (`main.tsx`), never starts the engine's module, and imports nothing from `auth/`, `store/` or `sync/`
 * (`CancelDeletionPage.test.tsx` checks that). It moves to account.orbyn.dev when that site ships.
 */

/** The token from the link's fragment, taken off the address at once so it stays out of history and of anything that reads the URL. */
let taken: string | null = null;
function takeToken(): string {
  // Read once per page load: React renders this page twice in development, and the second read would find the address already clean.
  if (taken !== null) return taken;
  taken = window.location.hash.replace(/^#/, "").trim();
  if (window.location.hash || window.location.search) window.history.replaceState(null, "", window.location.pathname);
  return taken;
}

/** For tests: forget the token read from the address, as a new page load does. */
export function forgetTokenForTests(): void {
  taken = null;
}

type Result = "ready" | "busy" | "done" | "invalid" | "error";

/** Posts the token once per press, and only a press: opening the page changes nothing, because mail scanners open links. */
async function cancelByMail(token: string): Promise<Exclude<Result, "ready" | "busy">> {
  try {
    const response = await fetch(`${engineUrl()}/v1/accounts/delete/cancel-by-mail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      referrerPolicy: "no-referrer",
      credentials: "omit",
      body: JSON.stringify({ token }),
    });
    if (response.ok) return "done";
    // A used, expired, voided or wrong token all get the same answer, so the page says nothing about the account.
    if (response.status === 400) return "invalid";
    return "error";
  } catch {
    return "error";
  }
}

export function CancelDeletionPage() {
  // Held in memory only, read once; a second render of the same page (React's development check) keeps the first read.
  const token = useRef<string | null>(null);
  const [result, setResult] = useState<Result>(() => (takeToken() ? "ready" : "invalid"));
  useEffect(() => {
    token.current ??= takeToken();
  }, []);
  const pressed = useRef(false);

  useEffect(() => {
    // The token never goes in a Referer header, whatever the page links to.
    const meta = document.createElement("meta");
    meta.name = "referrer";
    meta.content = "no-referrer";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  const press = async () => {
    if (pressed.current || !token.current) return;
    pressed.current = true;
    setResult("busy");
    const next = await cancelByMail(token.current);
    if (next === "error") pressed.current = false; // Try again presses the button again
    else {
      token.current = null; // used, or refused: the token is not needed again
      taken = ""; // and the copy read from the address goes too
    }
    setResult(next);
  };

  return (
    <main className="public-page" id="content" tabIndex={-1}>
      {result === "busy" ? (
        <div className="authcard keys-card" role="status" aria-label="Cancelling">
          <span className="spin blue" aria-hidden="true" />
          <h1 className="keys-title">Cancelling…</h1>
          <span className="t2">This takes a moment.</span>
        </div>
      ) : result === "done" ? (
        <div className="authcard keys-card" role="status" aria-label="Deletion cancelled">
          <span className="pv-ok"><Icon name="check2" size={22} /></span>
          <h1 className="keys-title">Deletion cancelled</h1>
          <span className="t2">Your Orbyn account is safe and nothing was deleted. Your devices pick this up the next time they sync.</span>
          <div className="pv-stack"><a className="btn lg" href="/">Open Orbyn</a></div>
        </div>
      ) : result === "invalid" ? (
        <div className="authcard keys-card" role="status" aria-label="This link doesn’t work any more">
          <span className="pv-red"><Icon name="alert" size={22} /></span>
          <h1 className="keys-title">This link doesn’t work any more</h1>
          <span className="t2">It may have been used already, or the deletion may have finished or been cancelled. Sign in to check.</span>
          <div className="pv-stack"><a className="btn lg" href="/">Sign in</a></div>
        </div>
      ) : result === "error" ? (
        <div className="authcard keys-card" role="alert" aria-label="Couldn’t cancel deletion">
          <span className="pv-red"><Icon name="alert" size={22} /></span>
          <h1 className="keys-title">Couldn’t cancel deletion</h1>
          <span className="t2">Orbyn didn’t answer, so nothing changed yet. Your deletion is still scheduled.</span>
          <div className="pv-stack"><button type="button" className="btn lg" onClick={() => void press()}>Try again</button></div>
        </div>
      ) : (
        <div className="authcard keys-card" role="group" aria-label="Cancel account deletion">
          <Icon name="info" size={22} />
          <h1 className="keys-title">Cancel account deletion?</h1>
          <span className="t2">Your Orbyn account is scheduled to be deleted. Nothing happens until you press the button. Opening this page doesn’t cancel anything.</span>
          <div className="pv-stack"><button type="button" className="btn lg" onClick={() => void press()}>Cancel deletion</button></div>
        </div>
      )}
    </main>
  );
}
