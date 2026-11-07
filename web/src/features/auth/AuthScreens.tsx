import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiFailure } from "../../api/auth";
import { SignInUnavailable } from "../../api/authCrypto";
import { BusyButton } from "../../components/BusyButton";
import { Icon } from "../../components/Icon";
import { KeysForAnotherAccount, SecondFactorNeeded, signIn, signUp, type PendingSignUp } from "../../auth/flows";
import { cryptoLoad } from "../../api/realCrypto";
import { CryptoProblem, MODULE_LOAD_FAILED } from "./CryptoProblem";
import { useAuth, type AuthScreen } from "../../auth/AuthProvider";

/** A readable line for whatever went wrong. */
export function describeError(error: unknown): string {
  if (error instanceof SignInUnavailable) return cryptoLoad.get() === "failed" ? `${MODULE_LOAD_FAILED}.` : error.message + ".";
  if (error instanceof ApiFailure) return error.message;
  return "Something went wrong. Try again.";
}

function Landing({ go }: { go: (s: AuthScreen) => void }) {
  const auth = useAuth()!;
  return (
    <div className="public">
      <span className="t3">Orbyn Planner</span>
      <h1>Your tasks and calendar,<br />in one calm place</h1>
      <p>
        Plan your day, keep lists, and share them with the people you live and work with. Simple enough for anyone, from a shopping list to a product launch.
      </p>
      <div className="public-actions">
        <button type="button" className="btn" onClick={() => go("signup")}>Get started</button>
        <button type="button" className="ghost" onClick={() => go("signin")}>Sign in</button>
      </div>
      <button type="button" className="link-btn quiet-link" onClick={auth.useWithoutAccount}>Use without an account</button>
      <span className="t3 small">Everything then stays on this device. You can sign in later.</span>
    </div>
  );
}

/** A new code can be asked for this long after the last one was sent. */
const RESEND_AFTER_MS = 60_000;
/** The engine allows three new codes an hour; the page counts them, since it answers the same whether or not one was sent. */
const RESENDS_PER_HOUR = 3;
const HOUR_MS = 3_600_000;

/** The code step of a sign-up: no account and no session exist until the code from the email is right. */
function CheckEmail({ pending, onBack, onDone }: { pending: PendingSignUp; onBack: () => void; onDone: () => void }) {
  const auth = useAuth()!;
  const clock = auth.services.now;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState(clock());
  const [resends, setResends] = useState<number[]>([]);
  const [, tick] = useState(0);
  const [engineLimited, setEngineLimited] = useState(false);
  const [keysFailed, setKeysFailed] = useState(false);

  // Leaving this screen lets the sign-up go: its keys were only ever in memory. React's development check unmounts and mounts a
  // screen at once to test this very cleanup, so the sign-up is let go only if no mount follows straight after.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current) pending.cancel();
      }, 0);
    };
  }, [pending]);
  // The countdown on "Send a new code".
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const recent = resends.filter((t) => clock() - t < HOUR_MS);
  const wait = Math.max(0, Math.ceil((lastSent + RESEND_AFTER_MS - clock()) / 1000));
  const limited = engineLimited || recent.length >= RESENDS_PER_HOUR;
  const digits = code.replace(/\D/g, "").slice(0, 6);
  const ready = digits.length === 6;
  const [focused, setFocused] = useState(true);
  const [wrong, setWrong] = useState(false);

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setWrong(false);
    try {
      await pending.verify(digits);
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure && e.code === "keys_not_saved") {
        setKeysFailed(true);
      } else if (e instanceof ApiFailure && e.code === "invalid_email_code") {
        // A wrong, an expired and a made-up code are one answer; "Send a new code" is always there.
        setWrong(true);
        setError("That code isn’t right. Use the code in the newest email.");
      } else {
        setError(describeError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    setWrong(false);
    try {
      await pending.resend();
      setResends([...recent, clock()]);
      setLastSent(clock());
      setCode("");
    } catch (e) {
      // The engine answers a resend it will not do with its own "too many attempts"; the page shows the same state it shows after three.
      if (e instanceof ApiFailure && e.code === "too_many_attempts") setEngineLimited(true);
      else setError(describeError(e));
    }
  };

  const retrySave = async () => {
    setBusy(true);
    try {
      await pending.retrySave();
      onDone();
    } catch {
      // Still not saved: the same screen stays, and Try saving again can be pressed once more.
    } finally {
      setBusy(false);
    }
  };

  if (keysFailed) {
    return (
      <div className="authcard" role="alert" aria-label="Account created, keys not saved">
        <Icon name="alert" />
        <h1 className="auth-title">Your account is ready, but this browser couldn’t save its keys</h1>
        <p className="t2">Your keys exist only in this tab right now. Keep it open until they’re saved.</p>
        <p className="t3 small">This usually happens in a private window, or when the browser blocks or is out of site storage.</p>
        <div className="pv-line">
          <button type="button" className="btn lg" disabled={busy} onClick={() => void retrySave()}>{busy ? "Saving…" : "Try saving again"}</button>
        </div>
      </div>
    );
  }

  const seconds = `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`;
  return (
    <form className="authcard" onSubmit={(e) => void verify(e)} aria-label="Check your email" noValidate>
      <h1 className="auth-title">Check your email</h1>
      <p className="t2">We sent a 6-digit code to <b style={{ fontWeight: "var(--fw-medium)" }}>{pending.email}</b>. It works for 30 minutes.</p>
      <div className="cboxes">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`cbox${wrong ? " err" : ""}${focused && !wrong && i === Math.min(digits.length, 5) ? " on" : ""}`} aria-hidden="true">{digits[i] ?? ""}</span>
        ))}
        {/* One real field under the six boxes: typing, paste and autofill all land in it. */}
        <input
          id="su-code"
          aria-label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={digits}
          onChange={(e) => {
            setCode(e.target.value);
            setWrong(false);
            setError(null);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus
        />
      </div>
      {error && <span className="err" role="alert">{error}</span>}
      {limited && (
        <div className="banner warn" role="status">
          <Icon name="alert" small />
          You’ve asked for several codes. Try again later, or check your spam folder.
        </div>
      )}
      <BusyButton type="submit" className="btn lg" busy={busy} disabled={!ready} idle="Verify" working="Checking…" />
      {limited ? (
        <span className="t4 small">Send a new code · not available right now</span>
      ) : wait > 0 ? (
        <span className="t3 small">Send a new code in {seconds}</span>
      ) : (
        <button type="button" className="link-btn small" onClick={() => void resend()}>Send a new code</button>
      )}
      <span className="t4 small">
        Wrong address? <button type="button" className="link-btn link" onClick={onBack}>Change email</button>
      </span>
    </form>
  );
}

function SignUp({ go }: { go: (s: AuthScreen) => void }) {
  const auth = useAuth()!;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set once the engine has sent a code: the sign-up waits for it. */
  const [pending, setPending] = useState<PendingSignUp | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setPending(await signUp(auth.services, { name, email, password }));
      setPassword(""); // the sign-up is waiting for its code: the password is not needed again, and is not kept in the page
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <CheckEmail
        pending={pending}
        onBack={() => {
          setPending(null);
          setPassword("");
        }}
        onDone={auth.closeAuth}
      />
    );
  }

  return (
    <form className="authcard" onSubmit={submit} aria-label="Create your account" noValidate>
      <h1 className="auth-title">Create your account</h1>
      <div className="form" style={{ width: "auto" }}>
        <label htmlFor="su-name">Name</label>
        <input id="su-name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="su-email">Email</label>
        <input id="su-email" className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="su-password">Password</label>
        <input id="su-password" className="field" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <p className="t3 small">Your password never leaves this device. Only a sealed proof of it is sent. We’ll email you a code to check the address.</p>
      <CryptoProblem />
      {error && <p className="err" role="alert">{error}</p>}
      <button type="submit" className="btn" disabled={busy || !email.trim() || password.length < 8}>
        {busy ? "Creating your account…" : "Create account"}
      </button>
      <span className="t3 small">
        Already have an account? <button type="button" className="link-btn" onClick={() => go("signin")}>Sign in</button>
      </span>
      <button type="button" className="link-btn quiet-link" onClick={auth.overlay ? auth.closeAuth : auth.useWithoutAccount}>
        {auth.overlay ? "Back to the planner" : "Use without an account"}
      </button>
    </form>
  );
}

function SignIn({ go }: { go: (s: AuthScreen) => void }) {
  const auth = useAuth()!;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** This browser holds another account's keys: nothing has been sent, and the person decides. */
  const [foreign, setForeign] = useState<KeysForAnotherAccount | null>(null);
  /** The password was right and the account has two-factor on: the sign-in waits for a code. */
  const [second, setSecond] = useState<SecondFactorNeeded | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [factor, setFactor] = useState("");

  // Leaving this screen with a sign-in still waiting for its code lets its keys go (releasing twice is harmless).
  useEffect(() => () => second?.cancel(), [second]);

  const stopSecond = () => {
    second?.cancel();
    setSecond(null);
    setFactor("");
    setRecovery(false);
  };

  const finishSecond = async (event: FormEvent) => {
    event.preventDefault();
    if (!second) return;
    setBusy(true);
    setError(null);
    try {
      await second.complete(recovery ? { recoveryCode: factor.trim() } : { code: factor.replace(/\D/g, "") });
      auth.closeAuth();
    } catch (e) {
      // A wrong code leaves the sign-in open to try again; anything else has ended it, so the password step comes back.
      if (e instanceof ApiFailure && e.code === "second_factor_failed") setError(describeError(e));
      else {
        setSecond(null);
        setFactor("");
        setRecovery(false);
        setError(e instanceof ApiFailure && e.code === "login_failed" ? "That sign-in ended. Enter your password to start again." : describeError(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const attempt = async (replaceKeys: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await signIn(auth.services, { email, password, replaceKeys });
      auth.closeAuth();
    } catch (e) {
      if (e instanceof KeysForAnotherAccount) setForeign(e);
      else if (e instanceof SecondFactorNeeded) setSecond(e);
      else setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void attempt(false);
  };

  if (second) {
    const ready = recovery ? factor.trim().length >= 5 : factor.replace(/\D/g, "").length === 6;
    return (
      <form className="authcard" onSubmit={(e) => void finishSecond(e)} aria-label="Two-factor code" noValidate>
        <h1 className="auth-title">Enter your code</h1>
        <p className="t3">{recovery ? "Enter one of your recovery codes. Each works once." : "Enter the six-digit code from your authenticator app."}</p>
        <div className="form" style={{ width: "auto" }}>
          <label htmlFor="si-factor">{recovery ? "Recovery code" : "Code"}</label>
          <input
            id="si-factor"
            key={recovery ? "recovery" : "code"}
            className="field"
            inputMode={recovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            placeholder={recovery ? "XXXXX-XXXXX" : "123456"}
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
            autoFocus
          />
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <button type="submit" className="btn" disabled={busy || !ready}>{busy ? "Checking…" : "Continue"}</button>
        <span className="t3 small">
          <button type="button" className="link-btn" onClick={() => { setRecovery(!recovery); setFactor(""); setError(null); }}>
            {recovery ? "Use a code from the app" : "Use a recovery code"}
          </button>{" "}
          · <button type="button" className="link-btn" onClick={stopSecond}>Cancel</button>
        </span>
      </form>
    );
  }

  if (foreign) {
    return (
      <div className="authcard" role="alertdialog" aria-modal="true" aria-label="Sign in to a different account" aria-describedby="foreign-keys">
        <h1 className="auth-title">Sign in to a different account?</h1>
        <p id="foreign-keys" className="t3">{foreign.message}</p>
        <div className="dialog-actions">
          <button type="button" className="ghost" data-autofocus onClick={() => setForeign(null)}>Cancel</button>
          <button type="button" className="btn" disabled={busy} onClick={() => { setForeign(null); void attempt(true); }}>Sign in anyway</button>
        </div>
      </div>
    );
  }

  return (
    <form className="authcard" onSubmit={submit} aria-label="Sign in" noValidate>
      <h1 className="auth-title">Sign in</h1>
      <div className="form" style={{ width: "auto" }}>
        <label htmlFor="si-email">Email</label>
        <input id="si-email" className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="si-password">Password</label>
        <input id="si-password" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <CryptoProblem />
      {error && <p className="err" role="alert">{error}</p>}
      <button type="submit" className="btn" disabled={busy || !email.trim() || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <span className="t3 small">
        New here? <button type="button" className="link-btn" onClick={() => go("signup")}>Create an account</button> ·{" "}
        <button type="button" className="link-btn" onClick={() => go("cant")}>Can’t sign in?</button>
      </span>
      <button type="button" className="link-btn quiet-link" onClick={auth.overlay ? auth.closeAuth : auth.useWithoutAccount}>
        {auth.overlay ? "Back to the planner" : "Use without an account"}
      </button>
    </form>
  );
}

function CantSignIn({ go }: { go: (s: AuthScreen) => void }) {
  const options: { icon: "check" | "bell" | "pin" | "users"; label: string; note: string; ready: boolean }[] = [
    { icon: "check", label: "Approve from a trusted device", note: "Sign in with your password here. This device then waits for one you already use to approve it.", ready: true },
    { icon: "pin", label: "Use a passkey", note: "Not available yet.", ready: false },
    { icon: "bell", label: "Recover with your email and phone", note: "Not available yet.", ready: false },
    { icon: "users", label: "Use a recovery key or contact", note: "Not available yet.", ready: false },
  ];
  return (
    <div className="authcard" role="group" aria-label="Can’t sign in?" style={{ width: "var(--sp-420)" }}>
      <h1 className="auth-title">Can’t sign in?</h1>
      <ul className="auth-options">
        {options.map((o) => (
          <li key={o.label} className="nav" style={{ height: "auto", minHeight: "var(--sp-44)", background: "var(--raise)", alignItems: "flex-start", padding: "var(--sp-10) var(--sp-8)", opacity: o.ready ? 1 : 0.7 }}>
            <Icon name={o.icon} small />
            <span>
              <span style={{ display: "block", color: "var(--t1)" }}>{o.label}</span>
              <span className="t3 small">{o.note}</span>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="ghost" onClick={() => go("signin")}>Back to sign in</button>
    </div>
  );
}

/** The public pages: landing, sign up, sign in and "Can’t sign in?". Shown full page when signed out, or over the planner. */
export function AuthScreens({ start }: { start: AuthScreen }) {
  const [screen, setScreen] = useState<AuthScreen>(start);
  return (
    <main className="public-page" id="content" tabIndex={-1}>
      {screen === "landing" ? <Landing go={setScreen} /> : screen === "signup" ? <SignUp go={setScreen} /> : screen === "signin" ? <SignIn go={setScreen} /> : <CantSignIn go={setScreen} />}
    </main>
  );
}
