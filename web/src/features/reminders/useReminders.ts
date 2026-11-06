import { useEffect, useRef } from "react";
import { usePrefs } from "../../app/prefs";
import { formatDue } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { ReminderScheduler, type Reminder } from "./schedule";

export type PermissionState = "unsupported" | "default" | "granted" | "denied";

export function permissionState(): PermissionState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** The scheduler's timers are rebuilt this often, so a task added long after load is still picked up. */
const REBUILD_MS = 3_600_000;

/**
 * While the app is open, shows a browser notification for each task reminder, if the person turned
 * reminders on in Settings and the browser allows it. This never asks for permission: Settings does.
 */
export function useReminders(): void {
  const { tasks } = usePlanner();
  const { prefs } = usePrefs();
  const quiet = useRef(prefs.quiet);
  const latest = useRef(tasks);
  const scheduler = useRef<ReminderScheduler | null>(null);
  useEffect(() => {
    quiet.current = prefs.quiet;
    latest.current = tasks;
  });
  const enabled = prefs.reminders && permissionState() === "granted";

  useEffect(() => {
    if (!enabled) return;
    const s = new ReminderScheduler({
      now: () => new Date(),
      quiet: () => quiet.current,
      notify: (r: Reminder) => {
        try {
          new Notification(r.task.title, { body: r.task.due ? `Due ${formatDue(r.task.due, new Date())}` : "", tag: r.key });
        } catch {
          // A browser can refuse to show one; nothing else to do.
        }
      },
    });
    scheduler.current = s;
    s.update(latest.current);
    const rebuild = setInterval(() => s.update(latest.current), REBUILD_MS);
    // Timers are unreliable in a hidden tab: look again, and show what came due, when it is back.
    const onVisible = () => {
      if (document.visibilityState === "visible") s.update(latest.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(rebuild);
      document.removeEventListener("visibilitychange", onVisible);
      s.stop();
      scheduler.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    scheduler.current?.update(tasks);
  }, [tasks]);
}
