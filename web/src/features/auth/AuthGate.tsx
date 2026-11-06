import type { ReactNode } from "react";
import { useAuth } from "../../auth/AuthProvider";
import { AuthScreens } from "./AuthScreens";
import { PendingScreen } from "./PendingScreen";

/** Shows the public pages while signed out, the approval screen while a device waits, and the planner otherwise. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth) return <>{children}</>;
  if (auth.status === "loading") return null;
  if (auth.status === "landing") return <AuthScreens start="landing" />;
  if (auth.status === "pending") return <PendingScreen />;
  if (auth.overlay) return <AuthScreens start={auth.overlay} />;
  return <>{children}</>;
}
