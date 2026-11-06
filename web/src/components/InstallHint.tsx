import { isDesktop } from "../app/platform";

/** A quiet note on the web that Orbyn Planner is coming as a desktop app. Never shown inside the desktop app. */
export function InstallHint() {
  if (isDesktop()) return null;
  return (
    <p className="t3 small install-hint">
      Orbyn Planner is coming as a desktop app. Until then it works in any modern browser, and your planner stays on this device.
    </p>
  );
}
