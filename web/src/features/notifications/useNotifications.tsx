import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNow } from "../../app/clock";
import { useAuth } from "../../auth/AuthProvider";
import { readProtection } from "../../auth/flows";
import { pendingChange, recordReport } from "../../auth/protectionNotice";
import { parseDue } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { reminderTime } from "../reminders/schedule";

const READ_KEY = "orbyn-planner.notifications-read";
const KEEP = 200;

function loadRead(): string[] {
  try {
    const raw = localStorage.getItem(READ_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** A reminder whose time has come for a task with a due time that is still open. */
export interface DueReminder {
  id: string;
  taskId: string;
  title: string;
  /** The due time, as "HH:mm" for the row. */
  dueAt: Date;
}

export interface Notifications {
  reminders: DueReminder[];
  protection: ReturnType<typeof pendingChange>;
  isRead: (id: string) => boolean;
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const Context = createContext<Notifications | null>(null);

export const protectionId = (seq: number) => `protection:${seq}`;

/**
 * What the Notifications page lists, and how many are unread, for the page and for the sidebar's count. So far: reminders that have
 * come due (tasks with a due time), and a protection change another device made. What was read is remembered in this browser.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { tasks } = usePlanner();
  const now = useNow();
  const auth = useAuth();
  const [read, setRead] = useState<string[]>(loadRead);
  const [protection, setProtection] = useState<ReturnType<typeof pendingChange>>(null);
  const session = auth?.session ?? null;
  const services = auth?.services;
  const trusted = session?.deviceState === "trusted";

  useEffect(() => {
    if (!trusted || !services || !session) return;
    let live = true;
    readProtection(services, session).then(
      (report) => {
        recordReport(session.accountId, report);
        if (live) setProtection(pendingChange(session.accountId, report));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [trusted, services, session]);

  const reminders = useMemo<DueReminder[]>(() => {
    const out: DueReminder[] = [];
    for (const task of tasks) {
      const at = reminderTime(task);
      if (!at || at.getTime() > now.getTime() || !task.due || !parseDue(task.due).hasTime) continue;
      out.push({ id: `reminder:${task.id}|${at.getTime()}`, taskId: task.id, title: task.title, dueAt: parseDue(task.due).date });
    }
    return out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  }, [tasks, now]);

  const save = (next: string[]) => {
    const kept = next.slice(-KEEP);
    setRead(kept);
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(kept));
    } catch {
      // Read marks last for this visit only.
    }
  };
  const markRead = useCallback((id: string) => save(read.includes(id) ? read : [...read, id]), [read]);
  const ids = [...reminders.map((r) => r.id), ...(protection ? [protectionId(protection.seq)] : [])];
  const value: Notifications = {
    reminders,
    protection,
    isRead: (id) => read.includes(id),
    unread: ids.filter((id) => !read.includes(id)).length,
    markRead,
    markAllRead: () => save([...new Set([...read, ...ids])]),
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useNotifications(): Notifications {
  const value = useContext(Context);
  if (!value) throw new Error("useNotifications needs a NotificationsProvider");
  return value;
}
