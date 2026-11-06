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
  // Over the planner (from Settings): the planner stays mounted but hidden, so coming back finds
  // the page as it was. It is always in the same wrapper, which takes no part in the layout.
  return (
    <>
      <div hidden={auth.overlay !== null} style={auth.overlay ? undefined : { display: "contents" }}>
        {children}
      </div>
      {auth.overlay && <AuthScreens start={auth.overlay} />}
    </>
  );
}
