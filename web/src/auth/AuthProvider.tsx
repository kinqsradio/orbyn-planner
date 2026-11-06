import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { StoredSession } from "../api/keyStore";
import { setSessionToken } from "../api/session";
import { signOut as signOutFlow } from "./flows";
import type { AuthServices } from "./services";

export type AuthStatus =
  /** Reading the saved session. */
  | "loading"
  /** Signed out and has not chosen to go on without an account: the public landing page. */
  | "landing"
  /** The planner on this device only. Signing in is optional. */
  | "local"
  /** Signed in, but this device waits for a trusted one to approve it. */
  | "pending"
  | "signedIn";

export type AuthScreen = "landing" | "signup" | "signin" | "cant";

interface AuthApiValue {
  services: AuthServices;
  status: AuthStatus;
  session: StoredSession | null;
  /** The sign-in screens open over the planner (from Settings), or null. */
  overlay: AuthScreen | null;
  openAuth: (screen?: AuthScreen) => void;
  closeAuth: () => void;
  /** "Use without an account": everything stays on this device. */
  useWithoutAccount: () => void;
  signOut: () => Promise<void>;
  /** Something that went wrong while signing out, to show. */
  problem: string | null;
}

const LOCAL_ONLY_KEY = "orbyn-planner.local-only";
const AuthContext = createContext<AuthApiValue | null>(null);

function readLocalOnly(): boolean {
  try {
    return localStorage.getItem(LOCAL_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Holds who is signed in. Without `services` there are no accounts (tests of the planner alone),
 * and the planner always runs on this device.
 */
export function AuthProvider({ services, children }: { services: AuthServices | null; children: ReactNode }) {
  const [loaded, setLoaded] = useState(services === null);
  const [localOnly, setLocalOnly] = useState(readLocalOnly);
  const [overlay, setOverlay] = useState<AuthScreen | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const none = useMemo(() => ({ subscribe: () => () => undefined, get: () => null as StoredSession | null }), []);
  const session = useSyncExternalStore(services ? services.tokens.subscribe : none.subscribe, services ? services.tokens.getSession : none.get);

  useEffect(() => {
    if (!services) return;
    let live = true;
    void services.ready.then(() => services.tokens.load(services.now())).then(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [services]);

  // Another tab signed out: this one drops its session too.
  useEffect(() => {
    if (!services) return;
    return services.signedOut.listen(() => void services.tokens.clear());
  }, [services]);

  // Engine requests made outside the auth screens (calendar feeds) read the token from here. Only a
  // trusted device's session is passed on: the engine refuses the rest.
  const engineToken = session?.deviceState === "trusted" ? session.token : null;
  useEffect(() => {
    setSessionToken(engineToken);
    return () => setSessionToken(null);
  }, [engineToken]);

  const status: AuthStatus = !services
    ? "local"
    : !loaded
      ? "loading"
      : session
        ? session.deviceState === "pending"
          ? "pending"
          : "signedIn"
        : localOnly
          ? "local"
          : "landing";

  const useWithoutAccount = useCallback(() => {
    try {
      localStorage.setItem(LOCAL_ONLY_KEY, "1");
    } catch {
      // Not remembered across visits, but fine for this one.
    }
    setLocalOnly(true);
    setOverlay(null);
  }, []);

  const value = useMemo<AuthApiValue | null>(() => {
    if (!services) return null;
    return {
      services,
      status,
      session,
      overlay,
      openAuth: (screen = "signin") => setOverlay(screen),
      closeAuth: () => setOverlay(null),
      useWithoutAccount,
      problem,
      signOut: async () => {
        setProblem(null);
        try {
          await signOutFlow(services);
        } catch (e) {
          setProblem(e instanceof Error ? e.message : "Signing out didn’t finish.");
        }
        setOverlay(null);
      },
    };
  }, [services, status, session, overlay, problem, useWithoutAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The account state, or null when this build runs without accounts. */
export function useAuth(): AuthApiValue | null {
  return useContext(AuthContext);
}
