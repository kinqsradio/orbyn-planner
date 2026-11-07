import { Icon } from "./Icon";
import type { IconName } from "./icons";

/** The Planned label (a feature the designs show that does not exist yet) and its quiet "Not available yet." */
export function Planned() {
  return <span className="st planned"><span className="sd" />Planned</span>;
}

/** A dimmed passkey button: drawn by the designs, not available yet, so it does nothing. */
export function PasskeyButton({ label, icon = "key" }: { label: string; icon?: IconName }) {
  return (
    <button type="button" className="ghost passkey-planned" disabled aria-disabled="true">
      <Icon name={icon} small />
      {label} <Planned /> <span className="t3 small">Not available yet.</span>
    </button>
  );
}
