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
    expect(screen.getByRole("heading", { name: "Done this week" })).toBeInTheDocument();
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

    const overdue = screen.getByRole("region", { name: "Overdue" });
    expect(within(overdue).getAllByRole("button").map((b) => b.textContent)).toEqual(["late yesterday", "earlier today"]);
    expect(screen.getByRole("heading", { name: "Overdue" })).toHaveClass("due-act");

    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getAllByRole("button").map((b) => b.textContent)).toEqual(["all day", "noon", "evening"]);

    const glance = screen.getByRole("region", { name: "The week at a glance" });
    const days = within(glance).getAllByRole("listitem").map((li) => li.textContent);
    expect(days).toEqual(["Sun 80", "Mon 92", "Tue 100", "Wed 110", "Thu 120"]);
    expect(screen.getByRole("region", { name: "Done this week" })).toHaveTextContent("1");
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
    expect(groups.week.map((w) => w.count)).toEqual([1, 2, 0, 0, 1]);
    expect(groups.week[0]!.date.getDate()).toBe(8);
    expect(groups.doneThisWeek).toBe(1);
    // Monday of the week is 2 November: a task done on 1 November does not count.
    expect(groupToday(store.getState().tasks, new Date(2026, 10, 16, 10, 0)).doneThisWeek).toBe(0);
  });
});
