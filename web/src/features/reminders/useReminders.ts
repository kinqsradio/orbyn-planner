import { useEffect, useRef, useState } from "react";
import { usePrefs } from "../../app/prefs";
import { formatDue } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { ReminderScheduler, type Reminder } from "./schedule";
import { listenShown, loadShown, rememberShown } from "./shown";

export type PermissionState = "unsupported" | "default" | "granted" | "denied";

export function permissionState(): PermissionState {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

/** The scheduler's timers are rebuilt this often, so a task added long after load is still picked up. */
const REBUILD_MS = 3_600_000;

/**
 * With several tabs open only one should show reminders. A tab asks for a browser lock and is the
 * one to notify while it holds it; when it closes the lock passes to another tab. Without Web
 * Locks every tab is its own leader.
 */
function useLeader(active: boolean): boolean {
  const [leader, setLeader] = useState(false);
  useEffect(() => {
    if (!active) return;
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (!locks) return;
    let release: (() => void) | null = null;
    let gone = false;
    locks
      .request("orbyn-planner-reminders", () => {
        if (gone) return undefined;
        setLeader(true);
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      release?.();
      setLeader(false);
    };
  }, [active]);
  const noLocks = typeof navigator === "undefined" || !navigator.locks;
  return active && (noLocks || leader);
}

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
  const wanted = prefs.reminders && permissionState() === "granted";
  const enabled = useLeader(wanted);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let cleanup = () => undefined as void;
    // What the leader before us already showed is read first, so a hand-over repeats nothing.
    void loadShown().then((shown) => {
      if (stopped) return;
      const s = new ReminderScheduler({
        now: () => new Date(),
        quiet: () => quiet.current,
        shown,
        onShown: (key) => rememberShown(key),
        notify: (r: Reminder) => {
          try {
            new Notification(r.task.title, { body: r.task.due ? `Due ${formatDue(r.task.due, new Date())}` : "", tag: r.key });
          } catch {
            // A browser can refuse to show one; nothing else to do.
          }
        },
      });
      scheduler.current = s;
      const unlisten = listenShown((key) => s.markShown(key));
      s.update(latest.current);
      const rebuild = setInterval(() => s.update(latest.current), REBUILD_MS);
      // Timers are unreliable in a hidden tab: look again, and show what came due, when it is back.
      const onVisible = () => {
        if (document.visibilityState === "visible") s.update(latest.current);
      };
      document.addEventListener("visibilitychange", onVisible);
      cleanup = () => {
        clearInterval(rebuild);
        document.removeEventListener("visibilitychange", onVisible);
        unlisten();
        s.stop();
        scheduler.current = null;
      };
    });
    return () => {
      stopped = true;
      cleanup();
    };
  }, [enabled]);

  useEffect(() => {
    scheduler.current?.update(tasks);
  }, [tasks]);
}
