import { useState, type FormEvent } from "react";
import { ApiFailure } from "../../api/auth";
import { SignInUnavailable } from "../../api/authCrypto";
import { Icon } from "../../components/Icon";
import { signIn, signUp } from "../../auth/flows";
import { useAuth, type AuthScreen } from "../../auth/AuthProvider";

/** A readable line for whatever went wrong. */
export function describeError(error: unknown): string {
  if (error instanceof SignInUnavailable) return error.message + ".";
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
    <form className="authcard" onSubmit={submit} aria-label="Create your account">
      <b className="auth-title">Create your account</b>
      <div className="form" style={{ width: "auto" }}>
        <label htmlFor="su-name">Name</label>
        <input id="su-name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="su-email">Email</label>
        <input id="su-email" className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="su-password">Password</label>
        <input id="su-password" className="field" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <p className="t3 small">Your password never leaves this device. Only a sealed proof of it is sent.</p>
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(auth.services, { email, password });
      auth.closeAuth();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="authcard" onSubmit={submit} aria-label="Sign in">
      <b className="auth-title">Sign in</b>
      <div className="form" style={{ width: "auto" }}>
        <label htmlFor="si-email">Email</label>
        <input id="si-email" className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="si-password">Password</label>
        <input id="si-password" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
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
    <div className="authcard" role="group" aria-label="Can’t sign in?" style={{ width: 420 }}>
      <b className="auth-title">Can’t sign in?</b>
      <ul className="auth-options">
        {options.map((o) => (
          <li key={o.label} className="nav" style={{ height: "auto", minHeight: 44, background: "var(--raise)", alignItems: "flex-start", padding: "10px 8px", opacity: o.ready ? 1 : 0.7 }}>
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
