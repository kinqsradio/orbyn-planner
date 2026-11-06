import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { groupToday } from "../tasks/selectors";

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
  it("keeps the empty state when nothing is due", async () => {
    await openToday((s) => s.addTask({ title: "someday" }));
    expect(screen.getByRole("heading", { name: "Nothing planned yet" })).toBeInTheDocument();
    expect(screen.getByText("Done this week")).toBeInTheDocument();
  });

  it("groups overdue and today in time order, with the week and the weekly stat", async () => {
    await openToday((s) => {
      s.addTask({ title: "late yesterday", due: "2026-11-06" });
      s.addTask({ title: "earlier today", due: "2026-11-07T08:00" });
      s.addTask({ title: "evening", due: "2026-11-07T18:30" });
      s.addTask({ title: "all day", due: "2026-11-07" });
      s.addTask({ title: "noon", due: "2026-11-07T12:00" });
      s.addTask({ title: "monday one", due: "2026-11-09" });
      s.addTask({ title: "monday two", due: "2026-11-09T09:00" });
      s.addTask({ title: "far away", due: "2026-12-25" });
      const finished = s.addTask({ title: "finished", due: "2026-11-05" });
      s.setDone(finished.id, true);
    });

    const rows = Array.from(document.querySelectorAll(".row .what")).map((el) => el.textContent);
    expect(rows).toEqual(["all day", "noon", "evening", "late yesterday", "earlier today"]);
    expect(screen.getByText("Overdue", { selector: "b" })).toHaveClass("amber");
    const times = Array.from(document.querySelectorAll(".row .time")).map((el) => el.textContent);
    expect(times).toEqual(["Any", "12:00", "18:30", "Fri", "08:00"]);

    const glance = screen.getByRole("list", { name: "The week at a glance" });
    const days = within(glance).getAllByRole("listitem").map((li) => li.textContent);
    expect(days).toEqual(["Sun 8Nothing planned", "Mon 92 tasks", "Tue 10Nothing planned", "Wed 11Nothing planned", "Thu 12Nothing planned"]);
    const stats = Array.from(document.querySelectorAll(".stat")).map((el) => el.textContent);
    expect(stats).toEqual(["Today3", "Overdue2", "This week6", "Done this week1"]);
    expect(screen.getByText("1 of 6")).toBeInTheDocument();
  });
});

describe("groupToday", () => {
  it("counts the next five days and this week's completions", async () => {
    const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW });
    await store.ready;
    store.addTask({ title: "a", due: "2026-11-08" });
    store.addTask({ title: "b", due: "2026-11-09T09:00" });
    store.addTask({ title: "c", due: "2026-11-09" });
    store.addTask({ title: "d", due: "2026-11-12" });
    store.addTask({ title: "e", due: "2026-11-13" }); // day six: outside the glance
    const x = store.addTask({ title: "x" });
    store.setDone(x.id, true);
    const groups = groupToday(store.getState().tasks, NOW);
    expect(groups.week.map((w) => w.tasks.length)).toEqual([1, 2, 0, 0, 1]);
    expect(groups.week[0]!.date.getDate()).toBe(8);
    expect(groups.doneThisWeek).toBe(1);
    // Monday of the week is 2 November: a task done on 1 November does not count.
    expect(groupToday(store.getState().tasks, new Date(2026, 10, 16, 10, 0)).doneThisWeek).toBe(0);
  });
});

describe("Today when storage fails", () => {
  it("shows a red pill and says nothing about changes being saved", async () => {
    window.history.replaceState(null, "", "/today");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const quota = new DOMException("full", "QuotaExceededError");
    const memory = new MemoryPersistence();
    const store = new LocalStore({
      persistence: { durable: true, setHandlers: () => undefined, load: () => memory.load(), read: (r) => memory.read(r), apply: () => Promise.reject(quota) },
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
