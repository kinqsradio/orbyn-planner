import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { repeatEvery } from "../../store/repeat";
import { viewDays } from "./CalendarPage";

// Friday 6 November 2026, 10:00. The week is Monday 2 to Friday 6, ISO week 45.
const NOW = new Date(2026, 10, 6, 10, 0);

async function open(options: { path?: string; seed?: (store: LocalStore) => void; fetchImpl?: typeof fetch } = {}) {
  window.history.replaceState(null, "", options.path ?? "/calendar");
  const fetchImpl = options.fetchImpl ?? (() => Promise.reject(new TypeError("offline")));
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  options.seed?.(store);
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  render(
    <ClockProvider value={() => NOW}>
      <App store={store} />
    </ClockProvider>,
    { container: root },
  );
  return store;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
afterEach(() => {
  document.getElementById("root")?.remove();
  document.body.style.overflow = "";
});

const seedWeek = (s: LocalStore) => {
  s.addEvent({ title: "Team planning", start: "2026-11-06T09:00", end: "2026-11-06T11:00", place: "Room 3" });
  s.addEvent({ title: "Book club", start: "2026-11-06T10:30", end: "2026-11-06T12:00" });
  s.addEvent({ title: "Lunch with Maya", start: "2026-11-05T13:00", end: "2026-11-05T14:00" });
  s.addEvent({ title: "Maya’s birthday", allDay: true, start: "2026-11-02", end: "2026-11-02" });
  s.addTask({ title: "Prepare the launch slides", due: "2026-11-05" });
  s.addTask({ title: "Book the dentist", due: "2026-11-30" });
};

describe("Week view", () => {
  it("places events by time, overlaps side by side with an amber note, and counts them", async () => {
    await open({ seed: seedWeek });
    expect(screen.getByRole("heading", { level: 1, name: "November 2026" })).toBeInTheDocument();
    expect(screen.getByText("Week 45")).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll(".dh")).map((d) => d.textContent)).toEqual(["Mon 2", "Tue 3", "Wed 4", "Thu 5", "Fri 6", "Sat 7", "Sun 8"]);

    const planning = screen.getByRole("button", { name: /Team planning/ });
    const club = screen.getByRole("button", { name: /Book club/ });
    expect(planning).toHaveClass("clash");
    expect(club).toHaveClass("clash");
    expect(club).toHaveTextContent("overlaps");
    expect(screen.getByRole("button", { name: /Lunch with Maya/ })).not.toHaveClass("clash");
    // 09:00 is 9 hours down at 52px an hour; side by side takes half the column each.
    expect(planning.style.top).toBe(`${9 * 52}px`);
    expect(planning.style.width).toContain("50%");
    expect(club.style.left).toContain("50%");

    const side = screen.getByRole("complementary", { name: "This week" });
    expect(within(side).getByText("Events").nextSibling).toHaveTextContent("4");
    expect(within(side).getByText("Overlaps").nextSibling).toHaveTextContent("1");
    expect(within(side).getByText("Prepare the launch slides")).toBeInTheDocument();
    expect(within(side).queryByText("Book the dentist")).not.toBeInTheDocument();
  });

  it("shows an all-day row and the red current-time line in today's column only", async () => {
    await open({ seed: seedWeek });
    const chip = screen.getByRole("button", { name: "Maya’s birthday" });
    expect(chip.closest(".adc")).not.toBeNull();
    const now = screen.getByTestId("now");
    expect(now.parentElement).toHaveAttribute("data-day", "2026-11-06");
    expect(now.style.top).toBe(`${(10 * 60 * 52) / 60}px`);
    expect(screen.getAllByTestId("now")).toHaveLength(1);
  });

  it("moves with the arrows and Today, and switches views", async () => {
    await open({ seed: seedWeek });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Week 46")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Team planning/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Week 44")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("Week 45")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Day" }));
    expect(screen.getByRole("heading", { level: 1, name: "Friday 6 November" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Team planning/ })).toHaveTextContent("09:00 to 11:00 · Room 3");

    await userEvent.click(screen.getByRole("radio", { name: "Agenda" }));
    expect(screen.getByText("Today · Fri 6")).toBeInTheDocument();
    expect(screen.getByText("Room 3 · 2h")).toBeInTheDocument();
  });

  it("shows the whole week by default, and Monday to Friday when asked", async () => {
    await open({ seed: seedWeek });
    expect(document.querySelectorAll(".dh")).toHaveLength(7);
    document.getElementById("root")?.remove();
    localStorage.setItem("orbyn-planner.prefs", JSON.stringify({ weekStart: "mon", weekDays: 5 }));
    await open({ seed: seedWeek });
    expect(Array.from(document.querySelectorAll(".dh")).map((d) => d.textContent)).toEqual(["Mon 2", "Tue 3", "Wed 4", "Thu 5", "Fri 6"]);
  });
});

describe("Day, Month and Agenda", () => {
  it("Day lists the day's tasks and all-day events beside the grid", async () => {
    await open({
      seed: (s) => {
        s.addTask({ title: "Send the brief", due: "2026-11-06T12:00" });
        s.addEvent({ title: "Family day", allDay: true, start: "2026-11-06", end: "2026-11-06" });
      },
    });
    await userEvent.click(screen.getByRole("radio", { name: "Day" }));
    const side = screen.getByRole("complementary", { name: "Tasks today" });
    expect(within(side).getByText("Send the brief")).toBeInTheDocument();
    expect(within(side).getByRole("button", { name: "Family day" })).toBeInTheDocument();
  });

  it("Month shows events in their cells, and a day number opens that day", async () => {
    await open({ seed: seedWeek });
    await userEvent.click(screen.getByRole("radio", { name: "Month" }));
    const cell = document.querySelector('[data-day="2026-11-06"]') as HTMLElement;
    expect(within(cell).getByRole("button", { name: "Team planning" })).toBeInTheDocument();
    expect(cell).toHaveClass("today");
    await userEvent.click(within(cell).getByRole("button", { name: "6 Friday" }));
    expect(screen.getByRole("heading", { level: 1, name: "Friday 6 November" })).toBeInTheDocument();
  });

  it("Month starts weeks on Sunday when asked", async () => {
    localStorage.setItem("orbyn-planner.prefs", JSON.stringify({ weekStart: "sun", weekDays: 5 }));
    await open();
    await userEvent.click(screen.getByRole("radio", { name: "Month" }));
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)[0]).toBe("Sun");
  });

  it("Agenda says when nothing is coming up", async () => {
    await open();
    await userEvent.click(screen.getByRole("radio", { name: "Agenda" }));
    expect(screen.getByRole("heading", { name: "Nothing coming up" })).toBeInTheDocument();
  });
});

describe("Event panel", () => {
  it("opens from an event, edits a plain event and saves", async () => {
    const store = await open({ seed: seedWeek });
    await userEvent.click(screen.getByRole("button", { name: /Lunch with Maya/ }));
    const panel = screen.getByRole("complementary", { name: "Event" });
    const title = within(panel).getByRole("textbox", { name: "Title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Lunch with Maya and Jo");
    await userEvent.type(within(panel).getByRole("textbox", { name: "Where" }), "Cafe");
    await userEvent.selectOptions(within(panel).getByRole("combobox", { name: "Reminder" }), "30");
    await userEvent.type(within(panel).getByRole("textbox", { name: "Add a person" }), "jo@example.com{Enter}");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));
    expect(store.getState().events.find((e) => e.title.startsWith("Lunch"))).toMatchObject({
      title: "Lunch with Maya and Jo",
      place: "Cafe",
      reminder: 30,
      people: [{ email: "jo@example.com", response: "none" }],
    });
  });

  it("will not save an event that ends before it starts", async () => {
    await open({ seed: seedWeek });
    await userEvent.click(screen.getByRole("button", { name: /Lunch with Maya/ }));
    const panel = screen.getByRole("complementary", { name: "Event" });
    await userEvent.clear(within(panel).getByLabelText("End date"));
    await userEvent.type(within(panel).getByLabelText("End date"), "2026-11-04");
    expect(within(panel).getByText("It ends before it starts.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("asks which events an edit reaches when the event repeats", async () => {
    const store = await open({
      seed: (s) => s.addEvent({ title: "Stand-up", start: "2026-11-02T09:00", end: "2026-11-02T09:30", repeat: repeatEvery("weekly") }),
    });
    await userEvent.click(screen.getByRole("button", { name: /Stand-up/ })); // Monday 2 November
    // Go to this Friday's week-mate: open the occurrence on Monday 2, then change the title.
    const panel = screen.getByRole("complementary", { name: "Event" });
    const title = within(panel).getByRole("textbox", { name: "Title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Stand-up (new room)");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));
    const scope = screen.getByRole("dialog", { name: "Save changes to" });
    expect(within(scope).getAllByRole("button").map((b) => b.textContent?.replace(/Only.*|This date.*|Every.*/, ""))).toEqual(["This event", "This and following", "All events", "Cancel"]);
    await userEvent.click(within(scope).getByRole("button", { name: /^This event/ }));
    const events = store.getState().events;
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.repeat)!.repeat!.skipped).toEqual(["2026-11-02"]);
    expect(events.find((e) => !e.repeat)).toMatchObject({ title: "Stand-up (new room)", start: "2026-11-02T09:00" });
  });

  it("All events changes the series, and Cancel changes nothing", async () => {
    const store = await open({
      seed: (s) => s.addEvent({ title: "Stand-up", start: "2026-11-02T09:00", end: "2026-11-02T09:30", repeat: repeatEvery("weekly") }),
    });
    await userEvent.click(screen.getByRole("button", { name: /Stand-up/ }));
    let panel = screen.getByRole("complementary", { name: "Event" });
    await userEvent.type(within(panel).getByRole("textbox", { name: "Where" }), "Room 9");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.getState().events[0]!.place).toBe("");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await userEvent.click(screen.getByRole("button", { name: /^All events/ }));
    expect(store.getState().events[0]!.place).toBe("Room 9");
    panel = await screen.findByRole("complementary", { name: "Event" });
    expect(within(panel).getByRole("textbox", { name: "Where" })).toHaveValue("Room 9");
  });

  it("deletes with an Undo, and asks the scope for a repeating event", async () => {
    const store = await open({
      seed: (s) => {
        s.addEvent({ title: "Stand-up", start: "2026-11-02T09:00", end: "2026-11-02T09:30", repeat: repeatEvery("daily") });
        s.addEvent({ title: "One-off", start: "2026-11-05T15:00", end: "2026-11-05T16:00" });
      },
    });
    await userEvent.click(screen.getByRole("button", { name: /One-off/ }));
    await userEvent.click(within(screen.getByRole("complementary", { name: "Event" })).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: /One-off/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: /One-off/ })).toBeInTheDocument();

    const tuesday = document.querySelector('[data-day="2026-11-03"]') as HTMLElement;
    await userEvent.click(within(tuesday).getByRole("button", { name: /Stand-up/ }));
    await userEvent.click(within(screen.getByRole("complementary", { name: "Event" })).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete" })).getByRole("button", { name: /^This event/ }));
    expect(within(document.querySelector('[data-day="2026-11-03"]') as HTMLElement).queryByRole("button", { name: /Stand-up/ })).not.toBeInTheDocument();
    expect(within(document.querySelector('[data-day="2026-11-04"]') as HTMLElement).getByRole("button", { name: /Stand-up/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(document.querySelector('[data-day="2026-11-03"]') as HTMLElement).getByRole("button", { name: /Stand-up/ })).toBeInTheDocument();
    expect(store.getState().events.find((e) => e.title === "Stand-up")!.deletedAt).toBeNull();
  });

  it("duplicates an event", async () => {
    const store = await open({ seed: seedWeek });
    await userEvent.click(screen.getByRole("button", { name: /Lunch with Maya/ }));
    await userEvent.click(within(screen.getByRole("complementary", { name: "Event" })).getByRole("button", { name: "Duplicate" }));
    expect(store.getState().events.filter((e) => e.title === "Lunch with Maya")).toHaveLength(2);
  });
});

describe("New event", () => {
  it("adds an event with its calendar, repeat, reminder and people", async () => {
    const store = await open();
    await userEvent.click(screen.getByRole("button", { name: "New event" }));
    const dialog = screen.getByRole("dialog", { name: "New event" });
    expect(within(dialog).getByRole("button", { name: "Add event" })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Title"), "Dentist");
    await userEvent.clear(within(dialog).getByLabelText("When"));
    await userEvent.type(within(dialog).getByLabelText("When"), "2026-11-13");
    await userEvent.clear(within(dialog).getByLabelText("Start time"));
    await userEvent.type(within(dialog).getByLabelText("Start time"), "15:00");
    await userEvent.clear(within(dialog).getByLabelText("End time"));
    await userEvent.type(within(dialog).getByLabelText("End time"), "15:45");
    await userEvent.selectOptions(within(dialog).getByLabelText("Repeat"), "monthly");
    await userEvent.selectOptions(within(dialog).getByLabelText("Reminder"), "60");
    await userEvent.type(within(dialog).getByLabelText("Invite people"), "maya@example.com, alex@example.com");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add event" }));
    expect(store.getState().events[0]).toMatchObject({
      title: "Dentist",
      start: "2026-11-13T15:00",
      end: "2026-11-13T15:45",
      reminder: 60,
      repeat: { start: "2026-11-13", repeat: { frequency: "monthly" } },
    });
    expect(store.getState().events[0]!.people.map((p) => p.email)).toEqual(["maya@example.com", "alex@example.com"]);
  });
});

describe("Calendars", () => {
  const feedBody = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261106", "SUMMARY:Bonfire night", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

  it("hides a calendar's events, renames it and adds another", async () => {
    const store = await open({ seed: seedWeek });
    await userEvent.click(screen.getByRole("button", { name: "Calendars" }));
    const dialog = screen.getByRole("dialog", { name: "Calendars" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Hide Personal" }));
    expect(store.getState().calendars[0]!.visible).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    const name = within(dialog).getByRole("textbox", { name: "Calendar name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Home{Enter}");
    expect(store.getState().calendars[0]!.name).toBe("Home");
    await userEvent.click(within(dialog).getByRole("button", { name: "New calendar" }));
    await userEvent.type(within(dialog).getByLabelText("Name"), "Work");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add calendar" }));
    expect(store.getState().calendars.map((c) => c.name)).toEqual(["Home", "Work"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: /Team planning/ })).not.toBeInTheDocument();
  });

  it("subscribes by link and shows the feed's events read-only", async () => {
    const store = await open({
      fetchImpl: async (url) => (String(url).endsWith(".ics") ? new Response(feedBody) : Promise.reject(new TypeError("offline"))),
    });
    await userEvent.click(screen.getByRole("button", { name: "Calendars" }));
    const dialog = screen.getByRole("dialog", { name: "Calendars" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Subscribe to a calendar" }));
    await userEvent.type(within(dialog).getByLabelText("Name"), "Holidays");
    await userEvent.type(within(dialog).getByLabelText("Subscribe by link"), "webcal://example.com/holidays.ics");
    await userEvent.click(within(dialog).getByRole("button", { name: "Subscribe" }));
    await waitFor(() => expect(store.getState().events.map((e) => e.title)).toEqual(["Bonfire night"]));
    expect(store.getState().events[0]!.readOnly).toBe(true);
    expect(vi.mocked(fetch).mock.calls.some(([u]) => u === "https://example.com/holidays.ics")).toBe(true);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: "Bonfire night" }));
    const panel = screen.getByRole("complementary", { name: "Event" });
    expect(within(panel).getByText(/can’t be changed here/)).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("the subscribe form refuses an http:// link", async () => {
    const store = await open();
    await userEvent.click(screen.getByRole("button", { name: "Calendars" }));
    const dialog = screen.getByRole("dialog", { name: "Calendars" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Subscribe to a calendar" }));
    await userEvent.type(within(dialog).getByLabelText("Name"), "Holidays");
    await userEvent.type(within(dialog).getByLabelText("Subscribe by link"), "http://example.com/h.ics");
    await userEvent.click(within(dialog).getByRole("button", { name: "Subscribe" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Use an https:// link");
    expect(store.getState().calendars).toHaveLength(1);
  });

  it("a feed that blocks the browser shows a red Retry and says why", async () => {
    let allow = false;
    const store = await open({
      fetchImpl: async (url) => {
        if (!String(url).endsWith(".ics")) throw new TypeError("offline");
        if (!allow) throw new TypeError("Failed to fetch");
        return new Response(feedBody);
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Calendars" }));
    const dialog = screen.getByRole("dialog", { name: "Calendars" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Subscribe to a calendar" }));
    await userEvent.type(within(dialog).getByLabelText("Name"), "Holidays");
    await userEvent.type(within(dialog).getByLabelText("Subscribe by link"), "https://example.com/h.ics");
    await userEvent.click(within(dialog).getByRole("button", { name: "Subscribe" }));
    const retry = await within(dialog).findByRole("button", { name: "Couldn’t refresh · Retry" });
    expect(retry).toHaveClass("red-text");
    expect(within(dialog).getByText(/doesn’t allow browser access yet/)).toBeInTheDocument();
    allow = true;
    await userEvent.click(retry);
    await waitFor(() => expect(store.getState().events.map((e) => e.title)).toEqual(["Bonfire night"]));
    expect(within(dialog).queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
  });
});

describe("Settings · Calendars", () => {
  it("lists the calendars and lets the week be set", async () => {
    await open({ path: "/settings" });
    expect(screen.getByRole("radio", { name: "7 days" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "5 days" }));
    expect(JSON.parse(localStorage.getItem("orbyn-planner.prefs")!)).toMatchObject({ weekDays: 5 });
    await userEvent.click(screen.getByRole("button", { name: "Calendars" }));
    expect(screen.getByRole("list", { name: "Calendars" })).toHaveTextContent("Personal");
    expect(screen.getByRole("button", { name: "Subscribe to a calendar" })).toBeInTheDocument();
  });
});

describe("Today with events", () => {
  it("lists today's events with its tasks in time order", async () => {
    await open({
      path: "/today",
      seed: (s) => {
        s.addEvent({ title: "Team planning", start: "2026-11-06T09:00", end: "2026-11-06T11:00", place: "Room 3" });
        s.addEvent({ title: "Book club", start: "2026-11-06T15:00", end: "2026-11-06T17:00" });
        s.addTask({ title: "Send the brief", due: "2026-11-06T11:30" });
        s.addTask({ title: "Pick up dry cleaning", due: "2026-11-06" });
        s.addEvent({ title: "Family day", allDay: true, start: "2026-11-06", end: "2026-11-06" });
      },
    });
    const rows = Array.from(document.querySelectorAll(".row .what")).map((el) => el.textContent);
    expect(rows).toEqual(["Team planning", "Send the brief", "Book club", "Family day", "Pick up dry cleaning"]);
    expect(screen.getByText("Event · Room 3")).toBeInTheDocument();
    expect(screen.getByText(/3 events, 2 tasks/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Book club" }));
    expect(screen.getByRole("complementary", { name: "Event" })).toBeInTheDocument();
  });
});

describe("after Undo of a deleted event", () => {
  it("focus returns to the restored event", async () => {
    await open({ seed: seedWeek });
    await userEvent.click(screen.getByRole("button", { name: /Lunch with Maya/ }));
    await userEvent.click(within(screen.getByRole("complementary", { name: "Event" })).getByRole("button", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    const back = await screen.findByRole("button", { name: /Lunch with Maya/ });
    await waitFor(() => expect(back).toHaveFocus());
  });
});

describe("Monday to Friday and the weekend", () => {
  it("viewDays shows 7 days when today is a weekend day of the week being shown, and 5 otherwise", () => {
    const week = (anchor: string, today: string, weekDays: 5 | 7 = 5, weekStart: "mon" | "sun" = "mon") => viewDays("week", anchor, weekStart, weekDays, today);
    // Saturday 7 and Sunday 8 November 2026: the current week keeps its weekend.
    expect(week("2026-11-07", "2026-11-07")).toHaveLength(7);
    expect(week("2026-11-07", "2026-11-07")[0]).toBe("2026-11-02");
    expect(week("2026-11-08", "2026-11-08")).toHaveLength(7);
    expect(week("2026-11-04", "2026-11-07")).toHaveLength(7); // another day of the same week
    // A weekday today, or another week, stays Monday to Friday.
    expect(week("2026-11-06", "2026-11-06")).toHaveLength(5);
    expect(week("2026-11-14", "2026-11-07")).toHaveLength(5);
    expect(week("2026-10-31", "2026-11-07")).toHaveLength(5);
    // The 7-day setting always shows 7, and a Sunday start keeps its own first day.
    expect(week("2026-11-06", "2026-11-06", 7)).toHaveLength(7);
    expect(week("2026-11-07", "2026-11-07", 5, "sun")[0]).toBe("2026-11-01");
  });

  it("the Week view includes today on a Saturday even with the 5-day setting", async () => {
    localStorage.setItem("orbyn-planner.prefs", JSON.stringify({ weekStart: "mon", weekDays: 5 }));
    // Saturday 7 November 2026.
    const saturday = new Date(2026, 10, 7, 10, 0);
    window.history.replaceState(null, "", "/calendar");
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => saturday, broadcast: false });
    await store.ready;
    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);
    render(
      <ClockProvider value={() => saturday}>
        <App store={store} />
      </ClockProvider>,
      { container: root },
    );
    expect(Array.from(document.querySelectorAll(".dh")).map((d) => d.textContent)).toEqual(["Mon 2", "Tue 3", "Wed 4", "Thu 5", "Fri 6", "Sat 7", "Sun 8"]);
    expect(document.querySelector(".dh.today")).toHaveTextContent("Sat 7");
    expect(screen.getByTestId("now").parentElement).toHaveAttribute("data-day", "2026-11-07");
    // The next week is an ordinary Monday to Friday week.
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(document.querySelectorAll(".dh")).toHaveLength(5);
  });
});

describe("keyboard", () => {
  it("Month: days are in rows, arrows move between them, Enter adds an event on that day", async () => {
    await open({ seed: seedWeek });
    await userEvent.click(screen.getByRole("radio", { name: "Month" }));
    const grid = screen.getByRole("grid", { name: "Month" });
    expect(within(grid).getAllByRole("row").length).toBeGreaterThanOrEqual(6);
    expect(within(within(grid).getAllByRole("row")[1]!).getAllByRole("gridcell")).toHaveLength(7);
    const today = document.querySelector('[data-day="2026-11-06"]') as HTMLElement;
    expect(today).toHaveAttribute("tabindex", "0");
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    today.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.querySelector('[data-day="2026-11-07"]')).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.querySelector('[data-day="2026-11-14"]')).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowUp}");
    expect(document.querySelector('[data-day="2026-11-06"]')).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}{Enter}");
    const dialog = screen.getByRole("dialog", { name: "New event" });
    expect(within(dialog).getByLabelText("When")).toHaveValue("2026-11-07");
  });

  it("Week: a focused hour slot takes Enter to add an event at that time", async () => {
    await open();
    const slot = document.querySelector('[data-slot="2026-11-06T14"]') as HTMLElement;
    slot.focus();
    expect(slot).toHaveAccessibleName(/Friday 6, 14:00/);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.querySelector('[data-slot="2026-11-06T15"]')).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{Enter}");
    const dialog = screen.getByRole("dialog", { name: "New event" });
    expect(within(dialog).getByLabelText("When")).toHaveValue("2026-11-05");
    expect(within(dialog).getByLabelText("Start time")).toHaveValue("15:00");
    expect(within(dialog).getByLabelText("End time")).toHaveValue("16:00");
  });

  it("Week: clicking a slot also adds an event there", async () => {
    await open();
    await userEvent.click(document.querySelector('[data-slot="2026-11-04T10"]') as HTMLElement);
    expect(within(screen.getByRole("dialog", { name: "New event" })).getByLabelText("Start time")).toHaveValue("10:00");
  });
});
