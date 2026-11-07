import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { duration, eventMeta } from "./PhoneCalendar";

// Saturday 7 November 2026, 10:00 (ISO week 45).
const NOW = new Date(2026, 10, 7, 10, 0);

async function open(seed?: (s: LocalStore) => void) {
  window.history.replaceState(null, "", "/calendar");
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  seed?.(store);
  render(
    <ClockProvider value={() => NOW}>
      <App store={store} />
    </ClockProvider>,
  );
  await screen.findByRole("group", { name: "Days" });
}

const strip = () => within(screen.getByRole("group", { name: "Days" })).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
const swipe = (el: Element, from: number, to: number) => {
  fireEvent.touchStart(el, { touches: [{ clientX: from, clientY: 100 }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: to, clientY: 100 }] });
};

beforeEach(() => vi.unstubAllGlobals());

describe("the Calendar on a phone", () => {
  it("shows the month, the week and the day, and today's list", async () => {
    await open((s) => {
      s.addEvent({ title: "Team planning", start: "2026-11-07T09:00", end: "2026-11-07T10:00", place: "Room 3" });
      s.addTask({ title: "Pick up dry cleaning", due: "2026-11-07" });
    });
    expect(screen.getByRole("button", { name: "November" })).toBeInTheDocument();
    expect(screen.getByText("Week 45 · Today")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "November" }).querySelector("svg")).not.toBeNull(); // the month title has its chevron
    expect(screen.getByText("Sat 7", { selector: "b" }).nextElementSibling).toHaveTextContent("1 event · 1 task");
    expect(Array.from(document.querySelectorAll(".row")).map((r) => r.textContent)).toEqual(["09:00Team planningRoom 3", "AnyPick up dry cleaning"]);
  });

  it("rule 1: five days with the chosen one in the middle; the chosen day is filled and today has a dot", async () => {
    await open();
    expect(strip()).toEqual(["Thu 5", "Fri 6", "Sat 7", "Sun 8", "Mon 9"]); // today in the middle
    await userEvent.click(screen.getByRole("button", { name: "Fri 6" }));
    expect(strip()).toEqual(["Wed 4", "Thu 5", "Fri 6", "Sat 7", "Sun 8"]); // Fri 6 in the middle
    await userEvent.click(screen.getByRole("button", { name: "Wed 4" }));
    expect(strip()).toEqual(["Mon 2", "Tue 3", "Wed 4", "Thu 5", "Fri 6"]); // Wed 4 in the middle
    expect(screen.getByRole("button", { name: "Wed 4" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Wed 4" })).toHaveClass("on");
    const dots = within(screen.getByRole("group", { name: "Days" })).getAllByRole("button").filter((b) => (b.querySelector("i") as HTMLElement).style.visibility === "visible");
    expect(dots.length).toBe(0); // today (Sat 7) is not in this strip: no dot
    await userEvent.click(screen.getByRole("button", { name: "Fri 6" }));
    const today = screen.getByRole("button", { name: "Sat 7" });
    expect(today).toHaveAttribute("aria-current", "date");
    expect((today.querySelector("i") as HTMLElement).style.visibility).toBe("visible");
  });

  it("rule 1: swiping the strip moves five days, swiping the list one; the strip follows; Today comes back", async () => {
    await open();
    const group = screen.getByRole("group", { name: "Days" });
    swipe(group, 300, 100); // left: forward five days
    expect(strip()).toEqual(["Tue 10", "Wed 11", "Thu 12", "Fri 13", "Sat 14"]);
    expect(screen.getByText("Week 46 · Thu 12")).toBeInTheDocument();
    swipe(group, 100, 300); // right: back five days
    expect(strip()).toEqual(["Thu 5", "Fri 6", "Sat 7", "Sun 8", "Mon 9"]);
    const list = document.querySelector(".pm-list")!;
    swipe(list, 300, 100);
    expect(screen.getByText("Week 45 · Sun 8")).toBeInTheDocument();
    expect(strip()).toEqual(["Fri 6", "Sat 7", "Sun 8", "Mon 9", "Tue 10"]);
    swipe(list, 120, 100); // too short to be a swipe
    expect(screen.getByText("Week 45 · Sun 8")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("Week 45 · Today")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull(); // on today there is nothing to come back to
  });

  it("rule 1: the month title opens a sheet with a month grid, Today and Done, and a pick moves the day", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "November" }));
    const sheet = screen.getByRole("dialog", { name: "Choose a day" });
    await waitFor(() => expect(within(sheet).getByRole("button", { name: "Done" })).toHaveFocus());
    await userEvent.click(within(sheet).getByRole("button", { name: "Wed 4" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Week 45 · Wed 4")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "November" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Today" }));
    await userEvent.keyboard("{Escape}"); // the shared dialog rule
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Week 45 · Today")).toBeInTheDocument();
  });

  it("the month sheet shows quiet days of the neighbouring months", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "November" }));
    const sheet = screen.getByRole("dialog", { name: "Choose a day" });
    expect(within(sheet).getByRole("button", { name: "Mon 26" }).className).toContain("quiet"); // 26 October leads the first week
    expect(within(sheet).getByRole("button", { name: "Sat 7" }).className).toContain("today");
  });

  it("rule 2: the sub line is always Week N · the chosen day, or Today", async () => {
    await open();
    expect(screen.getByText("Week 45 · Today")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Fri 6" }));
    expect(screen.getByText("Week 45 · Fri 6")).toBeInTheDocument();
  });

  it("an empty day says Nothing planned under the day's header, in the quiet text colour", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Fri 6" }));
    expect(screen.getByText("Fri 6", { selector: "b" })).toBeInTheDocument();
    expect(screen.getByText("Nothing planned")).toHaveClass("t3");
    expect(document.querySelectorAll(".row")).toHaveLength(0);
  });

  it("the left and right arrow keys move the day too", async () => {
    await open();
    screen.getByRole("button", { name: "Sat 7" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText("Week 45 · Sun 8")).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByText("Week 45 · Fri 6")).toBeInTheDocument();
  });
});

describe("rule 3: an event row shows the place, else the length, never both", () => {
  const o = (over: object) => ({ allDay: false, start: "2026-11-07T09:00", end: "2026-11-07T09:30", event: { place: "" }, ...over });
  it("place first, then duration, nothing for all-day", () => {
    expect(eventMeta(o({ event: { place: "Room 3" } }))).toBe("Room 3"); // a place wins over the 30 minutes
    expect(eventMeta(o({}))).toBe("30 min");
    expect(eventMeta(o({ end: "2026-11-07T10:00" }))).toBe("1 h");
    expect(eventMeta(o({ end: "2026-11-07T10:30" }))).toBe("1 h 30 min");
    expect(eventMeta(o({ allDay: true, start: "2026-11-07", end: "2026-11-07", event: { place: "Room 3" } }))).toBe("");
    expect(duration(45)).toBe("45 min");
  });

  it("in the list", async () => {
    await open((s) => {
      s.addEvent({ title: "Team planning", start: "2026-11-07T09:00", end: "2026-11-07T10:00", place: "Room 3" });
      s.addEvent({ title: "Launch stand-up", start: "2026-11-07T11:00", end: "2026-11-07T11:30" });
      s.addEvent({ title: "Maya’s birthday", allDay: true, start: "2026-11-07", end: "2026-11-07" });
    });
    const rows = Array.from(document.querySelectorAll(".row")).map((r) => r.textContent);
    expect(rows).toEqual(["All dayMaya’s birthday", "09:00Team planningRoom 3", "11:00Launch stand-up30 min"]);
  });
});
