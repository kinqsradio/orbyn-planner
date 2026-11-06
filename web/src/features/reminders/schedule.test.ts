import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuietHours } from "../../app/prefs";
import type { Task } from "../../store/types";
import { GRACE_MS, ReminderScheduler, inQuietHours, reminderTime, remindersFor } from "./schedule";

const task = (over: Partial<Task>): Task =>
  ({
    id: "t1", title: "Call Sam", notes: "", listId: "inbox", due: "2026-11-07T12:00", priority: "none", done: false, completedAt: null,
    deletedAt: null, checklist: [], projectId: null, sectionId: null, repeat: null, reminder: 15, completions: [],
    createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...over,
  }) as Task;

const at = (h: number, m = 0) => new Date(2026, 10, 7, h, m);
const NO_QUIET: QuietHours = { enabled: false, from: "22:00", to: "07:00" };

describe("reminderTime", () => {
  it("is the due time minus the reminder", () => {
    expect(reminderTime(task({ reminder: 15 }))).toEqual(at(11, 45));
    expect(reminderTime(task({ reminder: 0 }))).toEqual(at(12, 0));
    expect(reminderTime(task({ reminder: 60 }))).toEqual(at(11, 0));
    expect(reminderTime(task({ reminder: 1440 }))).toEqual(new Date(2026, 10, 6, 12, 0));
  });

  it("a date with no time reminds at 09:00 that day", () => {
    expect(reminderTime(task({ due: "2026-11-07", reminder: 0 }))).toEqual(at(9, 0));
    expect(reminderTime(task({ due: "2026-11-07", reminder: 30 }))).toEqual(at(8, 30));
  });

  it("needs a due date and a reminder, and ignores finished and deleted tasks", () => {
    expect(reminderTime(task({ due: null }))).toBeNull();
    expect(reminderTime(task({ reminder: null }))).toBeNull();
    expect(reminderTime(task({ done: true }))).toBeNull();
    expect(reminderTime(task({ deletedAt: "2026-11-06T10:00:00Z" }))).toBeNull();
  });

  it("orders reminders by time and gives each a stable key", () => {
    const list = remindersFor([task({ id: "b", due: "2026-11-07T14:00" }), task({ id: "a", due: "2026-11-07T09:00" })]);
    expect(list.map((r) => r.task.id)).toEqual(["a", "b"]);
    expect(remindersFor([task({ id: "a" })])[0]!.key).toBe(remindersFor([task({ id: "a" })])[0]!.key);
  });
});

describe("inQuietHours", () => {
  const q = (from: string, to: string): QuietHours => ({ enabled: true, from, to });

  it("a window inside one day", () => {
    expect(inQuietHours(at(13, 30), q("13:00", "14:00"))).toBe(true);
    expect(inQuietHours(at(12, 59), q("13:00", "14:00"))).toBe(false);
    expect(inQuietHours(at(14, 0), q("13:00", "14:00"))).toBe(false); // the end is outside
    expect(inQuietHours(at(13, 0), q("13:00", "14:00"))).toBe(true); // the start is inside
  });

  it("a window across midnight", () => {
    expect(inQuietHours(at(23, 0), q("22:00", "07:00"))).toBe(true);
    expect(inQuietHours(at(3, 0), q("22:00", "07:00"))).toBe(true);
    expect(inQuietHours(at(6, 59), q("22:00", "07:00"))).toBe(true);
    expect(inQuietHours(at(7, 0), q("22:00", "07:00"))).toBe(false);
    expect(inQuietHours(at(12, 0), q("22:00", "07:00"))).toBe(false);
    expect(inQuietHours(at(22, 0), q("22:00", "07:00"))).toBe(true);
  });

  it("is off when disabled or when it starts and ends together", () => {
    expect(inQuietHours(at(23, 0), { enabled: false, from: "22:00", to: "07:00" })).toBe(false);
    expect(inQuietHours(at(23, 0), q("22:00", "22:00"))).toBe(false);
  });
});

describe("ReminderScheduler", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  function setup(now: Date, quiet: QuietHours = NO_QUIET) {
    vi.setSystemTime(now);
    const notify = vi.fn();
    const scheduler = new ReminderScheduler({ now: () => new Date(), quiet: () => quiet, notify });
    return { notify, scheduler };
  }

  it("sets a timer for each upcoming reminder and shows it when it comes due", () => {
    const { notify, scheduler } = setup(at(11, 0));
    scheduler.update([task({ id: "a", due: "2026-11-07T12:00", reminder: 15 }), task({ id: "b", due: "2026-11-07T13:00", reminder: 0 })]);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(44 * 60_000);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000); // 11:45
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0].task.id).toBe("a");
    vi.advanceTimersByTime(75 * 60_000); // 13:00
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1]![0].task.id).toBe("b");
  });

  it("shows each reminder once, even when the tasks are updated again", () => {
    const { notify, scheduler } = setup(at(11, 0));
    const tasks = [task({ id: "a" })];
    scheduler.update(tasks);
    vi.advanceTimersByTime(45 * 60_000);
    scheduler.update(tasks);
    scheduler.check();
    vi.advanceTimersByTime(60_000);
    scheduler.update([{ ...tasks[0]!, title: "Call Sam back" }]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("a task moved to a later time loses its old timer and gets a new one", () => {
    const { notify, scheduler } = setup(at(11, 0));
    scheduler.update([task({ id: "a", due: "2026-11-07T12:00" })]);
    scheduler.update([task({ id: "a", due: "2026-11-07T15:00" })]);
    vi.advanceTimersByTime(60 * 60_000); // past the old 11:45
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3 * 3_600_000); // to 14:45 and a little beyond
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("a finished, deleted or reminder-less task is not scheduled", () => {
    const { notify, scheduler } = setup(at(11, 0));
    scheduler.update([task({ id: "a", done: true }), task({ id: "b", deletedAt: "2026-11-07T10:00:00Z" }), task({ id: "c", reminder: null })]);
    vi.advanceTimersByTime(3_600_000);
    expect(notify).not.toHaveBeenCalled();
  });

  it("only schedules the next day; later ones wait for a rebuild", () => {
    const { notify, scheduler } = setup(at(11, 0));
    const far = task({ id: "a", due: "2026-11-09T12:00", reminder: 0 });
    scheduler.update([far]);
    vi.advanceTimersByTime(25 * 3_600_000);
    expect(notify).not.toHaveBeenCalled();
    scheduler.update([far]); // the hourly rebuild, now within the day
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("check() shows a reminder that came due while timers were not running, but not an old one", () => {
    const { notify, scheduler } = setup(at(11, 0));
    scheduler.update([task({ id: "a", due: "2026-11-07T12:00", reminder: 0 }), task({ id: "old", due: "2026-11-07T11:30", reminder: 0 })]);
    // The tab was hidden: the clock moved on, no timer ran.
    vi.setSystemTime(at(12, 5));
    scheduler.check();
    expect(35 * 60_000).toBeGreaterThan(GRACE_MS);
    expect(notify.mock.calls.map((c) => c[0].task.id)).toEqual(["a"]);
    scheduler.check();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("stays quiet inside quiet hours, and does not show the skipped reminder later", () => {
    const { notify, scheduler } = setup(at(21, 0), { enabled: true, from: "22:00", to: "07:00" });
    scheduler.update([task({ id: "a", due: "2026-11-07T22:30", reminder: 0 }), task({ id: "b", due: "2026-11-07T21:30", reminder: 0 })]);
    vi.advanceTimersByTime(30 * 60_000); // 21:30, outside quiet hours
    expect(notify.mock.calls.map((c) => c[0].task.id)).toEqual(["b"]);
    vi.advanceTimersByTime(60 * 60_000); // 22:30, inside
    expect(notify).toHaveBeenCalledTimes(1);
    vi.setSystemTime(at(23, 59));
    scheduler.check();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("reads the quiet hours when a reminder fires, so changing them takes effect at once", () => {
    let quiet: QuietHours = NO_QUIET;
    vi.setSystemTime(at(11, 0));
    const notify = vi.fn();
    const scheduler = new ReminderScheduler({ now: () => new Date(), quiet: () => quiet, notify });
    scheduler.update([task({ id: "a", due: "2026-11-07T12:00", reminder: 0 })]);
    quiet = { enabled: true, from: "11:30", to: "12:30" };
    vi.advanceTimersByTime(3_600_000);
    expect(notify).not.toHaveBeenCalled();
  });

  it("stop() clears every timer", () => {
    const { notify, scheduler } = setup(at(11, 0));
    scheduler.update([task({ id: "a" })]);
    scheduler.stop();
    vi.advanceTimersByTime(3_600_000);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("a reminder in whole days", () => {
  it("counts calendar days, so it keeps the hour across a clock change", () => {
    const t = task({ due: "2026-11-02T09:00", reminder: 1440 * 2 });
    const at = reminderTime(t)!;
    expect([at.getMonth(), at.getDate(), at.getHours()]).toEqual([9, 31, 9]);
  });
});

describe("a hand-over between tabs", () => {
  it("does not repeat what the last leader showed, and reports what it shows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(12, 5));
    const t = task({ reminder: 0 }); // due 12:00, five minutes ago: inside the grace period
    const key = `${t.id}|${at(12).getTime()}`;
    const notify = vi.fn();
    const heirs = new ReminderScheduler({ now: () => new Date(), quiet: () => NO_QUIET, notify, shown: [key] });
    heirs.update([t]);
    expect(notify).not.toHaveBeenCalled();
    const onShown = vi.fn();
    const fresh = new ReminderScheduler({ now: () => new Date(), quiet: () => NO_QUIET, notify, onShown });
    fresh.update([t]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(onShown).toHaveBeenCalledWith(key);
    const other = new ReminderScheduler({ now: () => new Date(), quiet: () => NO_QUIET, notify });
    other.markShown(key);
    other.update([t]);
    expect(notify).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
