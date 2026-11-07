import { useEffect, useState, type FormEvent } from "react";
import { ApiFailure } from "../../api/auth";
import { SignInUnavailable } from "../../api/authCrypto";
import { Icon } from "../../components/Icon";
import { KeysForAnotherAccount, SecondFactorNeeded, signIn, signUp } from "../../auth/flows";
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

function SignUp({ go }: { go: (s: AuthScreen) => void }) {
  const auth = useAuth()!;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signUp(auth.services, { name, email, password });
      auth.closeAuth();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

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
      <p className="t3 small">Your password never leaves this device. Only a sealed proof of it is sent.</p>
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
