import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNow } from "../../app/clock";
import { useAuth } from "../../auth/AuthProvider";
import { readProtection } from "../../auth/flows";
import { pendingChange, readKey, recordReport } from "../../auth/protectionNotice";
import { browserStorage } from "../../lib/browserStorage";
import { MONTHS, WEEKDAYS, addDays, formatTime, parseDue, startOfDay } from "../../lib/dates";
import { usePlanner } from "../../store/context";
import { reminderTime } from "../reminders/schedule";

const KEEP = 200;

function loadRead(accountId: string): string[] {
  try {
    const raw = browserStorage.get(readKey(accountId));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** A reminder whose time has come for a task that is still open, with a time or a date alone. */
export interface DueReminder {
  id: string;
  taskId: string;
  /** The row's words: "Send the launch brief is due at 12:00", "Pay rent is due today", "Pay rent was due yesterday". */
  text: string;
  /** For ordering: the reminder's moment. */
  at: Date;
}

/** "tomorrow", or "Monday 9 November". */
const dayWords = (day: Date, today: Date) => {
  if (day.getTime() === addDays(today, 1).getTime()) return "tomorrow";
  if (day.getTime() === addDays(today, -1).getTime()) return "yesterday";
  return `${WEEKDAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`;
};

/** A task's due, in words. A time is shown only for a timed task due today; a date alone never shows one. */
export function dueWords(title: string, due: string, now: Date): string {
  const { date, hasTime } = parseDue(due);
  const today = startOfDay(now);
  const day = startOfDay(date);
  if (day.getTime() < today.getTime()) return `${title} was due ${dayWords(day, today)}`;
  if (day.getTime() === today.getTime()) return hasTime ? `${title} is due at ${formatTime(date)}` : `${title} is due today`;
  return `${title} is due ${dayWords(day, today)}`;
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
  const [protection, setProtection] = useState<ReturnType<typeof pendingChange>>(null);
  const session = auth?.session ?? null;
  const services = auth?.services;
  const trusted = session?.deviceState === "trusted";
  // What was read is kept per account, so one account's marks never show for another.
  const accountKey = session?.accountId ?? "device";
  const [readState, setReadState] = useState<{ account: string; ids: string[] }>(() => ({ account: accountKey, ids: loadRead(accountKey) }));
  const read = readState.account === accountKey ? readState.ids : loadRead(accountKey);

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
      if (!at || at.getTime() > now.getTime() || !task.due) continue;
      out.push({ id: `reminder:${task.id}|${at.getTime()}`, taskId: task.id, text: dueWords(task.title, task.due, now), at });
    }
    // Newest first, as the frame lists them.
    return out.sort((a, b) => b.at.getTime() - a.at.getTime());
  }, [tasks, now]);

  const save = (next: string[]) => {
    const kept = next.slice(-KEEP);
    setReadState({ account: accountKey, ids: kept });
    try {
      browserStorage.set(readKey(accountKey), JSON.stringify(kept));
    } catch {
      // Read marks last for this visit only.
    }
  };
  const markRead = (id: string) => save(read.includes(id) ? read : [...read, id]);
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
