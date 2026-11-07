import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

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

beforeEach(() => vi.unstubAllGlobals());

describe("the Calendar on a phone", () => {
  it("shows the month, the week, a strip of five days ending today, and today's list", async () => {
    await open((s) => {
      s.addEvent({ title: "Team planning", start: "2026-11-07T09:00", end: "2026-11-07T10:00", place: "Room 3" });
      s.addTask({ title: "Pick up dry cleaning", due: "2026-11-07" });
    });
    expect(screen.getByRole("heading", { name: "November" })).toBeInTheDocument();
    expect(screen.getByText("Week 45")).toBeInTheDocument();
    const strip = screen.getByRole("group", { name: "Days" });
    expect(within(strip).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Tue 3", "Wed 4", "Thu 5", "Fri 6", "Sat 7"]);
    expect(within(strip).getByRole("button", { name: "Sat 7" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Sat 7", { selector: "b" }).nextElementSibling).toHaveTextContent("1 event · 1 task");
    expect(Array.from(document.querySelectorAll(".row")).map((r) => r.textContent)).toEqual(["09:00Team planningRoom 3", "AnyPick up dry cleaning"]);
  });

  it("an empty day says Nothing planned under the day's header, in the quiet text colour, and the sub line names the day", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Wed 4" }));
    expect(screen.getByText("Week 45 · Wed 4")).toBeInTheDocument();
    expect(screen.getByText("Wed 4", { selector: "b" })).toBeInTheDocument();
    const empty = screen.getByText("Nothing planned");
    expect(empty).toHaveClass("t3");
    expect(document.querySelectorAll(".row")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Fri 6" }));
    expect(screen.getByText("Week 45 · Fri 6")).toBeInTheDocument();
    expect(screen.getByText("Nothing planned")).toBeInTheDocument();
  });

  it("picking a day with something on it lists it, and every day in the strip has its dot, as drawn", async () => {
    await open((s) => s.addEvent({ title: "Launch stand-up", start: "2026-11-03T09:00", end: "2026-11-03T09:30" }));
    await userEvent.click(screen.getByRole("button", { name: "Tue 3" }));
    expect(screen.getByText("Week 45 · Tue 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch stand-up" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing planned")).toBeNull();
    for (const label of ["Tue 3", "Wed 4", "Thu 5", "Fri 6", "Sat 7"]) expect(screen.getByRole("button", { name: label }).querySelector("i")).not.toBeNull();
  });
});
