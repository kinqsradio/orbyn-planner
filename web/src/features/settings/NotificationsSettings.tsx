import { useState } from "react";
import { usePrefs } from "../../app/prefs";
import { Icon } from "../../components/Icon";
import { Planned } from "../../components/Planned";
import { Toggle } from "../../components/Toggle";
import { permissionState, type PermissionState } from "../reminders/useReminders";

const SETTING = { minHeight: "var(--sp-44)", borderBottom: "var(--bw) solid var(--line)" } as const;

/** A label with its quieter second line, at the left of a row. */
function Label({ title, note }: { title: string; note?: string }) {
  return (
    <span>
      {title}
      {note && (
        <>
          <br />
          <span className="t4 fine">{note}</span>
        </>
      )}
    </span>
  );
}

const PlannedRow = ({ label, last = false }: { label: string; last?: boolean }) => (
  <div className="kv" style={{ ...SETTING, borderBottom: last ? undefined : SETTING.borderBottom, opacity: "var(--op-planned)" }}>
    <span>{label}</span>
    <b><Planned /> <span className="t4 fine">Not available yet.</span></b>
  </div>
);

/**
 * Notifications that are still loading: the labels stay and the values load. Settings are kept on this device and read at once, so
 * nothing shows this yet; it is here for when they come from the account.
 */
export function NotificationsLoading() {
  return (
    <>
      <p className="t3" role="status"><span className="spin" aria-hidden="true" /> Loading notifications</p>
      <div className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }}>
        <div className="kv" style={SETTING}><span>Remind me about tasks</span><span className="skel" style={{ width: "var(--sp-30)" }} /></div>
        <PlannedRow label="When someone changes a shared list" />
        <PlannedRow label="Daily summary email" />
        <div className="kv" style={SETTING}><span>Quiet hours</span><span className="skel" style={{ width: "var(--sp-120)" }} /></div>
        <div className="kv" style={{ minHeight: "var(--sp-44)" }}><span>Allow reminders during quiet hours</span><span className="skel" style={{ width: "var(--sp-30)" }} /></div>
      </div>
    </>
  );
}

/** A quiet-hours edit that did not save: what did not change, and the edit stays visible beside "Not saved". */
export function QuietHoursNotSaved({ saved, onDiscard, onRetry }: { saved: { from: string; to: string }; onDiscard: () => void; onRetry: () => void }) {
  return (
    <div className="banner err" role="alert">
      <Icon name="alert" small />
      Couldn’t save quiet hours. They’re still {saved.from} to {saved.to} on every device.
      <span className="end">
        <button type="button" className="ghost sm" onClick={onDiscard}>Discard</button>
        <button type="button" className="btn sm" onClick={onRetry}>Try again</button>
      </span>
    </div>
  );
}

/**
 * Settings · Notifications: reminders on this device and quiet hours. Permission is asked here, on the click that turns reminders on.
 * Server push, email, shared lists and the daily summary are Planned, so they only say so.
 */
export function NotificationsSettings({ unsaved }: { /** A quiet-hours edit that failed to save (nothing reports that yet). */ unsaved?: { saved: { from: string; to: string }; onDiscard: () => void; onRetry: () => void } } = {}) {
  const { prefs, setPrefs } = usePrefs();
  const [permission, setPermission] = useState<PermissionState>(permissionState);
  const [asking, setAsking] = useState(false);
  const on = prefs.reminders && permission === "granted";
  const blocked = permission === "denied";

  const toggle = async (wanted: boolean) => {
    if (!wanted) return setPrefs({ reminders: false });
    let state = permissionState();
    if (state === "default") {
      setAsking(true);
      try {
        const answer = await Notification.requestPermission();
        state = answer === "granted" || answer === "denied" ? answer : "default";
      } catch {
        state = permissionState();
      } finally {
        setAsking(false);
      }
    }
    setPermission(state);
    setPrefs({ reminders: state === "granted" });
  };

  const note = permission === "unsupported" ? "This browser can’t show notifications." : blocked ? "Blocked in this browser." : asking ? "Allow notifications when your browser asks." : on ? "On this device. Turning it on asks your browser for permission." : "Reminders are off on this device.";
  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <>
      <label htmlFor={id} className="t3">{label}</label>
      <input id={id} className="inp" type="time" value={value} onChange={(e) => e.target.value && set(e.target.value)} />
    </>
  );

  return (
    <>
      {blocked && (
        <div className="banner warn" role="status">
          <Icon name="alert" small />
          Notifications are blocked in your browser. Allow them in the site settings to get reminders.
        </div>
      )}
      {unsaved && <QuietHoursNotSaved {...unsaved} />}
      <div className="bh"><b>Reminders</b><span></span></div>
      <div className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }}>
        <div className="kv" style={SETTING}>
          <Label title="Remind me about tasks" note={note} />
          <b className="ctl">
            {asking ? (
              <span className="t4"><span className="spin" aria-hidden="true" /> Waiting for your browser</span>
            ) : permission === "granted" ? (
              <span className="st ok"><span className="sd" />Allowed in this browser</span>
            ) : permission === "default" ? (
              <span className="st"><span className="sd" />Not asked yet</span>
            ) : blocked ? (
              <span className="st warn"><span className="sd" />Blocked in this browser</span>
            ) : null}
            <Toggle label="Remind me about tasks" on={on || asking || blocked} checked={on || asking} disabled={permission === "unsupported" || blocked} onChange={(v) => void toggle(v)} />
          </b>
        </div>
        <PlannedRow label="Server push and email reminders" />
        <PlannedRow label="When someone changes a shared list" />
        <PlannedRow label="Daily summary email" last />
      </div>

      <p className="t4 fine">Reminders only work while Orbyn Planner is open in a browser tab.</p>

      <div className="bh"><b>Quiet hours</b><span></span></div>
      <div className="card" style={{ gap: 0, padding: "0 var(--sp-14)" }}>
        <div className="kv" style={SETTING}>
          <span>Quiet hours</span>
          <b className="ctl">
            {field("quiet-from", "From", prefs.quiet.from, (from) => setPrefs({ quiet: { ...prefs.quiet, from } }))}
            {field("quiet-to", "Until", prefs.quiet.to, (to) => setPrefs({ quiet: { ...prefs.quiet, to } }))}
            {unsaved && <span className="pillx red">Not saved</span>}
          </b>
        </div>
        <div className="kv" style={{ minHeight: "var(--sp-44)" }}>
          <Label title="Allow reminders during quiet hours" note="Reminders still fire during quiet hours." />
          <Toggle label="Allow reminders during quiet hours" on={!prefs.quiet.enabled} checked={!prefs.quiet.enabled} onChange={(allow) => setPrefs({ quiet: { ...prefs.quiet, enabled: !allow } })} />
        </div>
      </div>
    </>
  );
}
