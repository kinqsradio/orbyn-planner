import { useState } from "react";
import { usePrefs } from "../../app/prefs";
import { permissionState, type PermissionState } from "../reminders/useReminders";

const PERMISSION_TEXT: Record<PermissionState, string> = {
  unsupported: "This browser can’t show notifications.",
  default: "Not asked yet. Turning reminders on will ask this browser for permission.",
  granted: "This browser allows notifications.",
  denied: "This browser is blocking notifications for Orbyn Planner. Allow them in the browser’s site settings, then turn reminders on.",
};

function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="pill" disabled={disabled} onClick={() => onChange(!checked)}>
      {checked ? "On" : "Off"}
    </button>
  );
}

/** Settings · Notifications: reminders and quiet hours. Permission is asked here, on the click that turns reminders on. */
export function NotificationsSettings() {
  const { prefs, setPrefs } = usePrefs();
  const [permission, setPermission] = useState<PermissionState>(permissionState);
  const on = prefs.reminders && permission === "granted";

  const toggle = async (wanted: boolean) => {
    if (!wanted) return setPrefs({ reminders: false });
    let state = permissionState();
    if (state === "default") {
      try {
        const answer = await Notification.requestPermission();
        state = answer === "granted" || answer === "denied" ? answer : "default";
      } catch {
        state = permissionState();
      }
    }
    setPermission(state);
    setPrefs({ reminders: state === "granted" });
  };

  return (
    <>
      <div className="bh"><b>Reminders</b><span></span></div>
      <div className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }}>
        <div className="kv" style={{ height: "var(--sp-44)" }}>
          <span>Remind me about tasks</span>
          <Switch label="Remind me about tasks" checked={on} disabled={permission === "unsupported"} onChange={(v) => void toggle(v)} />
        </div>
      </div>
      <p className="t3" style={{ fontSize: "var(--fs-12-5)" }} role="status">{PERMISSION_TEXT[permission]}</p>
      <p className="t3" style={{ fontSize: "var(--fs-12-5)" }}>
        Reminders only work while Orbyn Planner is open in a browser tab. The phone and desktop apps will remind you when it’s closed.
        A task with a date but no time reminds at 09:00.
      </p>

      <div className="bh"><b>Quiet hours</b><span></span></div>
      <div className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }}>
        <div className="kv" style={{ height: "var(--sp-44)", borderBottom: "var(--bw) solid var(--line)" }}>
          <span>No notifications during quiet hours</span>
          <Switch label="Quiet hours" checked={prefs.quiet.enabled} onChange={(enabled) => setPrefs({ quiet: { ...prefs.quiet, enabled } })} />
        </div>
        <div className="kv" style={{ height: "var(--sp-44)", borderBottom: "var(--bw) solid var(--line)" }}>
          <label htmlFor="quiet-from">From</label>
          <b className="ctl"><input id="quiet-from" className="inp" type="time" value={prefs.quiet.from} onChange={(e) => e.target.value && setPrefs({ quiet: { ...prefs.quiet, from: e.target.value } })} /></b>
        </div>
        <div className="kv" style={{ height: "var(--sp-44)" }}>
          <label htmlFor="quiet-to">Until</label>
          <b className="ctl"><input id="quiet-to" className="inp" type="time" value={prefs.quiet.to} onChange={(e) => e.target.value && setPrefs({ quiet: { ...prefs.quiet, to: e.target.value } })} /></b>
        </div>
      </div>
      <p className="t3" style={{ fontSize: "var(--fs-12-5)" }}>A reminder that falls inside quiet hours is skipped, not delayed.</p>
    </>
  );
}
