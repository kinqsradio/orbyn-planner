import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { groupToday } from "../tasks/selectors";
import { TodayError, goalLabel } from "./TodayPage";

// Saturday 7 November 2026, 10:00.
const NOW = new Date(2026, 10, 7, 10, 0);

async function openToday(seed?: (store: LocalStore) => void) {
  window.history.replaceState(null, "", "/today");
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW });
  await store.ready;
  seed?.(store);
  render(
    <ClockProvider value={() => NOW}>
      <App store={store} />
    </ClockProvider>,
  );
  return store;
}

beforeEach(() => vi.unstubAllGlobals());

describe("Today page", () => {
  const stats = () => Array.from(document.querySelectorAll(".stat")).map((el) => el.textContent);

  it("says nothing is planned, offers one action, and keeps the week column", async () => {
    await openToday((s) => s.addTask({ title: "someday" }));
    expect(screen.getByRole("heading", { name: "Nothing planned today" })).toBeInTheDocument();
    expect(screen.getByText("No events or tasks. Add one, or look at the week.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a task" })).toBeInTheDocument();
    expect(screen.getByText("Saturday 7 November · nothing planned")).toBeInTheDocument();
    expect(stats()).toEqual(["Today0", "Overdue0", "Coming up0", "Done today0"]);
    expect(within(screen.getByRole("list", { name: "The week at a glance" })).getAllByRole("listitem")).toHaveLength(6);
    expect(screen.queryByText("Progress")).toBeNull(); // no project has a goal in the next 30 days
  });

  it("groups overdue and today in time order, with the week from tomorrow and the four numbers", async () => {
    await openToday((s) => {
      s.addTask({ title: "late yesterday", due: "2026-11-06" });
      s.addTask({ title: "earlier today", due: "2026-11-07T08:00" });
      s.addTask({ title: "evening", due: "2026-11-07T18:30" });
      s.addTask({ title: "all day", due: "2026-11-07" });
      s.addTask({ title: "noon", due: "2026-11-07T12:00" });
      s.addTask({ title: "soon", due: "2026-11-07T10:30" });
      s.addTask({ title: "monday one", due: "2026-11-09" });
      s.addTask({ title: "monday two", due: "2026-11-09T09:00" });
      s.addTask({ title: "far away", due: "2026-12-25" });
      const finished = s.addTask({ title: "finished", due: "2026-11-05" });
      s.setDone(finished.id, true);
    });

    const rows = Array.from(document.querySelectorAll(".row .what")).map((el) => el.textContent);
    expect(rows).toEqual(["soon", "noon", "evening", "all day", "late yesterday", "earlier today"]);
    expect(screen.getByText("Overdue", { selector: "b" })).toHaveClass("amber");
    const times = Array.from(document.querySelectorAll(".row .time")).map((el) => el.textContent);
    expect(times).toEqual(["10:30", "12:00", "18:30", "Any", "Fri", "08:00"]);
    // Amber for a task due within the hour, and for an overdue one; not for noon, two hours away.
    const amber = Array.from(document.querySelectorAll(".row .time.amber")).map((el) => el.textContent);
    expect(amber).toEqual(["10:30", "Fri", "08:00"]);
    // A task row says its list, or how late it is.
    expect(Array.from(document.querySelectorAll(".row .meta")).map((el) => el.textContent)).toEqual(["Inbox", "Inbox", "Inbox", "Inbox", "1 day late", "Inbox"]);

    const glance = screen.getByRole("list", { name: "The week at a glance" });
    const days = within(glance).getAllByRole("listitem").map((li) => li.textContent);
    expect(days).toEqual(["Sun 8Nothing planned", "Mon 92 tasks", "Tue 10Nothing planned", "Wed 11Nothing planned", "Thu 12Nothing planned", "Fri 13Nothing planned"]);
    expect(stats()).toEqual(["Today4", "Overdue2", "Coming up2", "Done today1"]);
    expect(screen.getByText("Saturday 7 November · 4 tasks")).toBeInTheDocument();
  });

  it("puts all-day events in their own group above the timed ones, with the calendar's name and the day of a longer one", async () => {
    await openToday((s) => {
      s.addEvent({ title: "Maya’s birthday", allDay: true, start: "2026-11-07", end: "2026-11-07" });
      s.addEvent({ title: "Tiling", allDay: true, start: "2026-11-06", end: "2026-11-08" });
      s.addEvent({ title: "Team planning", start: "2026-11-07T09:00", end: "2026-11-07T10:00", place: "Room 3" });
      s.addEvent({ title: "Lunch", start: "2026-11-07T13:00", end: "2026-11-07T14:00" });
      s.addEvent({ title: "Dentist", start: "2026-11-13T15:00", end: "2026-11-13T16:00" });
    });
    expect(screen.getByText("All day", { selector: "b" }).nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText("Timed", { selector: "b" })).toBeInTheDocument();
    const rows = Array.from(document.querySelectorAll(".row")).map((el) => el.textContent);
    expect(rows).toEqual(["All dayTiling · day 2 of 3Personal", "All dayMaya’s birthdayPersonal", "09:00Team planningEvent · Room 3", "13:00LunchEvent"]);
    const glance = within(screen.getByRole("list", { name: "The week at a glance" }));
    expect(glance.getByText("Dentist 15:00")).toBeInTheDocument(); // one event: its name and time
    expect(screen.getByText("Saturday 7 November · 4 events")).toBeInTheDocument();
  });

  it("orders all-day events by start, then a multi-day one before a single-day one, then by title", async () => {
    await openToday((s) => {
      s.addEvent({ title: "Beta", allDay: true, start: "2026-11-07", end: "2026-11-07" });
      s.addEvent({ title: "Alpha", allDay: true, start: "2026-11-07", end: "2026-11-07" });
      s.addEvent({ title: "Zed trip", allDay: true, start: "2026-11-07", end: "2026-11-08" });
      s.addEvent({ title: "Early", allDay: true, start: "2026-11-06", end: "2026-11-07" });
    });
    const titles = Array.from(document.querySelectorAll(".row .what")).map((el) => el.textContent);
    expect(titles).toEqual(["Early · day 2 of 2", "Zed trip · day 1 of 2", "Alpha", "Beta"]);
  });

  it("shows up to three projects with a goal in the next 30 days, nearest first, and says 'goal today' for today", async () => {
    await openToday((s) => {
      const near = s.addProject({ name: "Spring launch", colour: "c1", goal: "2026-11-07" });
      s.addProject({ name: "Garden", colour: "c2", goal: "2026-11-20" });
      s.addProject({ name: "Taxes", colour: "c3", goal: "2026-12-01" });
      s.addProject({ name: "Later", colour: "c4", goal: "2026-12-05" });
      s.addProject({ name: "Too far", colour: "c1", goal: "2027-03-01" });
      s.addProject({ name: "No goal", colour: "c2", goal: null });
      const a = s.addTask({ title: "a", projectId: near.id });
      s.addTask({ title: "b", projectId: near.id });
      s.setDone(a.id, true);
    });
    const progress = screen.getByText("Progress", { selector: "b" }).parentElement!.parentElement!;
    const lines = Array.from(progress.querySelectorAll(".kv")).filter((el) => el.textContent?.includes("%")).map((el) => el.firstElementChild!.textContent);
    expect(lines).toEqual(["Spring launch", "Garden", "Taxes"]);
    expect(screen.getByText("50% · goal today")).toBeInTheDocument();
  });

  it("a long list is laid out in steps: the first rows at once, the rest on the next frames, all of them in the end", async () => {
    await openToday((s) => {
      for (let i = 0; i < 150; i++) s.addTask({ title: `late ${i}`, due: "2026-11-05" });
    });
    const count = () => document.querySelectorAll(".row").length;
    expect(count()).toBeLessThan(150); // the page does not wait for a hundred and fifty rows
    expect(count()).toBeGreaterThan(0);
    await waitFor(() => expect(count()).toBe(150), { timeout: 8000 });
    expect(stats()[1]).toBe("Overdue150"); // the numbers never depended on how many rows were drawn
  }, 20_000);

  it("greets by the clock: morning from 05:00, afternoon from 12:00, evening from 18:00, and until 04:59", async () => {
    const { greetingAt } = await import("./TodayPage");
    expect(greetingAt(new Date(2026, 10, 7, 4, 59))).toBe("Good evening");
    expect(greetingAt(new Date(2026, 10, 7, 5, 0))).toBe("Good morning");
    expect(greetingAt(new Date(2026, 10, 7, 11, 59))).toBe("Good morning");
    expect(greetingAt(new Date(2026, 10, 7, 12, 0))).toBe("Good afternoon");
    expect(greetingAt(new Date(2026, 10, 7, 17, 59))).toBe("Good afternoon");
    expect(greetingAt(new Date(2026, 10, 7, 18, 0))).toBe("Good evening");
  });
});

describe("Today while it loads, and on a phone", () => {
  it("keeps its layout while loading and shows the skeleton only after 400 ms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      window.history.replaceState(null, "", "/today");
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
      const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW });
      await store.ready;
      // A store that has not finished loading: same store, but it says it is not ready.
      const notReady = { ...store.getState(), ready: false }; // one object: a new one each call would loop
      const loading = Object.assign(Object.create(store) as LocalStore, { getState: () => notReady });
      render(<ClockProvider value={() => NOW}><App store={loading} /></ClockProvider>);
      expect(screen.getByText("Today", { selector: "small" })).toBeInTheDocument();
      expect(document.querySelector(".skel")).toBeNull();
      expect(screen.queryByText("Loading today")).toBeNull();
      await act(async () => void (await vi.advanceTimersByTimeAsync(450)));
      expect(screen.getByText("Loading today")).toBeInTheDocument();
      expect(document.querySelectorAll(".skel").length).toBeGreaterThan(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it("on a phone: the title is Today, the count is items, there are no stats, events have no meta, and This week is one collapsed row", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    await openToday((s) => {
      s.addEvent({ title: "Lunch", start: "2026-11-07T13:00", end: "2026-11-07T14:00", place: "Cafe" });
      s.addTask({ title: "Pick up", due: "2026-11-07" });
      s.addTask({ title: "Monday", due: "2026-11-09" });
    });
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByText("Saturday 7 November · 2 items")).toBeInTheDocument();
    expect(document.querySelector(".row .meta")?.textContent).toBe("");
    const fold = screen.getByRole("button", { name: /^This week\s*1 item$/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "The week at a glance" })).toBeNull();
  });

  it("an empty day on a phone is A clear day, with Open the week beside Add a task", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    await openToday();
    expect(screen.getByRole("heading", { name: "A clear day" })).toBeInTheDocument();
    expect(screen.getByText("No events or tasks today. Add one, or look at the week.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open the week" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a task" })).toBeInTheDocument();
  });
});

describe("goal labels and the error card", () => {
  const at = (goal: string) => goalLabel(goal, new Date(2026, 10, 7, 10, 0)); // Saturday 7 November
  it("name today and tomorrow, then the weekday for six days, then the date, and mirror it into the past", () => {
    expect(at("2026-11-07")).toBe("goal today");
    expect(at("2026-11-08")).toBe("goal tomorrow");
    expect(at("2026-11-11")).toBe("goal Wednesday");
    expect(at("2026-11-13")).toBe("goal Friday"); // six days on
    expect(at("2026-11-14")).toBe("goal 14 Nov"); // seven days on
    expect(at("2026-11-06")).toBe("goal yesterday");
    expect(at("2026-11-02")).toBe("goal Monday");
    expect(at("2026-11-01")).toBe("goal Sunday"); // six days back
    expect(at("2026-10-31")).toBe("goal 31 Oct");
  });
  it("the error card says what happened and offers Try again", async () => {
    const retry = vi.fn();
    render(<TodayError onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t open your planner on this device.");
    expect(screen.getByText("Nothing was changed. Your other devices still have everything.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("groupToday", () => {
  it("counts the next six days, and what was finished today and this week", async () => {
    const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW });
    await store.ready;
    store.addTask({ title: "a", due: "2026-11-08" });
    store.addTask({ title: "b", due: "2026-11-09T09:00" });
    store.addTask({ title: "c", due: "2026-11-09" });
    store.addTask({ title: "d", due: "2026-11-12" });
    store.addTask({ title: "e", due: "2026-11-13" });
    store.addTask({ title: "f", due: "2026-11-14" }); // day seven: outside the glance
    const x = store.addTask({ title: "x" });
    store.setDone(x.id, true);
    const groups = groupToday(store.getState().tasks, NOW);
    expect(groups.week.map((w) => w.tasks.length)).toEqual([1, 2, 0, 0, 1, 1]);
    expect(groups.week[0]!.date.getDate()).toBe(8);
    expect(groups.doneToday).toBe(1);
    expect(groups.doneThisWeek).toBe(1);
    // Monday of the week is 2 November: a task done on 1 November does not count.
    expect(groupToday(store.getState().tasks, new Date(2026, 10, 16, 10, 0)).doneThisWeek).toBe(0);
    expect(groupToday(store.getState().tasks, new Date(2026, 10, 8, 10, 0)).doneToday).toBe(0);
  });
});

describe("Today when storage fails", () => {
  it("shows a red pill and says nothing about changes being saved", async () => {
    window.history.replaceState(null, "", "/today");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const quota = new DOMException("full", "QuotaExceededError");
    const memory = new MemoryPersistence();
    const store = new LocalStore({
      persistence: { durable: true, setHandlers: () => undefined, load: () => memory.load(), read: (r) => memory.read(r), acknowledge: (s) => memory.acknowledge(s), apply: () => Promise.reject(quota) },
      now: () => NOW,
      broadcast: false,
    });
    await store.ready;
    await store.flush();
    render(
      <ClockProvider value={() => NOW}>
        <App store={store} />
      </ClockProvider>,
    );
    const pill = await screen.findByText("Couldn’t save on this device");
    expect(pill.closest("p")).toHaveClass("red");
    expect(document.body.textContent).not.toMatch(/saved here/i);
  });
});

describe("Done this week with repeating tasks", () => {
  it("counts each completion of a repeating task", async () => {
    const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
    await store.ready;
    const t = store.addTask({ title: "Water plants", due: "2026-11-07", repeat: { frequency: "daily", interval: 1, weekdays: [], end: { type: "never" } } });
    store.setDone(t.id, true);
    store.setDone(t.id, true);
    const once = store.addTask({ title: "One-off" });
    store.setDone(once.id, true);
    expect(groupToday(store.getState().tasks, NOW).doneThisWeek).toBe(3);
    expect(groupToday(store.getState().tasks, NOW).doneToday).toBe(3);
  });
});
