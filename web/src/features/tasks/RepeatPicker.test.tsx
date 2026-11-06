import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { repeatEvery, type Repeat } from "../../store/repeat";
import { RepeatPicker, kindOf, ruleFor } from "./RepeatPicker";

// Saturday 7 November 2026, 10:00.
const NOW = new Date(2026, 10, 7, 10, 0);

describe("kindOf and ruleFor", () => {
  it("name the simple rules and send everything else to Custom", () => {
    expect(kindOf(null)).toBe("never");
    expect(kindOf(repeatEvery("daily"))).toBe("daily");
    expect(kindOf(repeatEvery("monthly"))).toBe("monthly");
    expect(kindOf(repeatEvery("yearly"))).toBe("yearly");
    expect(kindOf({ ...repeatEvery("weekly"), weekdays: ["mon", "tue", "wed", "thu", "fri"] })).toBe("weekdays");
    expect(kindOf({ ...repeatEvery("weekly"), weekdays: ["tue"] })).toBe("weekly-on");
    expect(kindOf({ ...repeatEvery("daily"), interval: 2 })).toBe("custom");
    expect(kindOf({ ...repeatEvery("daily"), end: { type: "count", value: 3 } })).toBe("custom");
  });

  it("weekly on… starts on the start date's weekday", () => {
    expect(ruleFor("weekly-on", "2026-11-07", null)).toMatchObject({ frequency: "weekly", weekdays: ["sat"] });
    expect(ruleFor("weekdays", "2026-11-07", null)!.weekdays).toHaveLength(5);
    expect(ruleFor("never", "2026-11-07", repeatEvery("daily"))).toBeNull();
  });
});

describe("RepeatPicker", () => {
  function setup(value: Repeat | null = null) {
    const onChange = vi.fn();
    render(<RepeatPicker value={value} start="2026-11-07" onChange={onChange} />);
    return onChange;
  }

  it("offers the seven choices", () => {
    setup();
    const options = within(screen.getByRole("combobox", { name: "Repeat" })).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Never", "Daily", "Weekdays", "Weekly on…", "Monthly", "Yearly", "Custom…"]);
  });

  it("reports the rule for a simple choice", async () => {
    const onChange = setup();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repeat" }), "weekdays");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ frequency: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"] }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repeat" }), "never");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("Weekly on… picks days and keeps at least one", async () => {
    const onChange = setup();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repeat" }), "weekly-on");
    const days = screen.getByRole("group", { name: "On these days" });
    expect(within(days).getByRole("button", { name: "Sat" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(days).getByRole("button", { name: "Mon" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ weekdays: ["sat", "mon"] }));
    await userEvent.click(within(days).getByRole("button", { name: "Sat" }));
    await userEvent.click(within(days).getByRole("button", { name: "Mon" })); // the last one stays
    expect(within(days).getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Custom sets every N units, weekdays and an end", async () => {
    const onChange = setup();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repeat" }), "custom");
    const every = screen.getByRole("spinbutton", { name: "Every" });
    await userEvent.clear(every);
    await userEvent.type(every, "3");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Unit" }), "weekly");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ frequency: "weekly", interval: 3 }));
    await userEvent.click(within(screen.getByRole("group", { name: "On these days" })).getByRole("button", { name: "Wed" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Ends" }), "count");
    const times = screen.getByRole("spinbutton", { name: "Times" });
    await userEvent.clear(times);
    await userEvent.type(times, "4");
    expect(onChange).toHaveBeenLastCalledWith({ frequency: "weekly", interval: 3, weekdays: ["sat", "wed"], end: { type: "count", value: 4 } });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Ends" }), "until");
    expect(screen.getByLabelText("Ends on")).toHaveValue("2026-11-07");
  });

  it("does not report a rule the engine would refuse", async () => {
    const onChange = setup();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Repeat" }), "custom");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Ends" }), "until");
    onChange.mockClear();
    const until = screen.getByLabelText("Ends on");
    await userEvent.clear(until);
    await userEvent.type(until, "2026-11-01");
    expect(screen.getByText("a repeat cannot end before it starts")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ end: { type: "until", value: "2026-11-01" } }));
  });
});

async function openApp(seed: (s: LocalStore) => void) {
  window.history.replaceState(null, "", "/tasks");
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  seed(store);
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
  document.getElementById("root")?.remove();
});

describe("repeat in the task panel and the new task dialog", () => {
  it("asks This task / This and following / All before moving a repeating task's due date", async () => {
    const store = await openApp((s) => s.addTask({ title: "Review", due: "2026-11-09", repeat: repeatEvery("weekly") }));
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    const panel = screen.getByRole("complementary", { name: "Task" });
    fireEvent.change(within(panel).getByLabelText("Due date"), { target: { value: "2026-11-11" } });
    const dialog = screen.getByRole("dialog", { name: "Change" });
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent?.split(/Only|This time|The whole/)[0])).toEqual(["This task", "This and following", "All", "Cancel"]);
    await userEvent.click(within(dialog).getByRole("button", { name: /^This task/ }));
    const task = store.getState().tasks[0]!;
    expect(task.due).toBe("2026-11-11");
    expect(task.repeat!.start).toBe("2026-11-09");
  });

  it("Cancel leaves the task and the picker as they were", async () => {
    const store = await openApp((s) => s.addTask({ title: "Review", due: "2026-11-09", repeat: repeatEvery("weekly") }));
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    const panel = screen.getByRole("complementary", { name: "Task" });
    await userEvent.selectOptions(within(panel).getByRole("combobox", { name: "Repeat" }), "daily");
    await userEvent.click(within(screen.getByRole("dialog", { name: "Change" })).getByRole("button", { name: "Cancel" }));
    expect(store.getState().tasks[0]!.repeat!.repeat.frequency).toBe("weekly");
    expect(within(screen.getByRole("complementary", { name: "Task" })).getByRole("combobox", { name: "Repeat" })).toHaveValue("weekly-on");
  });

  it("changing the repeat with This and following restarts the rule from this date", async () => {
    const store = await openApp((s) => s.addTask({ title: "Review", due: "2026-11-09", repeat: repeatEvery("weekly") }));
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    await userEvent.selectOptions(within(screen.getByRole("complementary", { name: "Task" })).getByRole("combobox", { name: "Repeat" }), "monthly");
    await userEvent.click(within(screen.getByRole("dialog", { name: "Change" })).getByRole("button", { name: /^This and following/ }));
    expect(store.getState().tasks[0]!.repeat).toMatchObject({ start: "2026-11-09", repeat: { frequency: "monthly" } });
  });

  it("adding a repeat to a plain task does not ask", async () => {
    const store = await openApp((s) => s.addTask({ title: "Bins", due: "2026-11-09" }));
    await userEvent.click(await screen.findByRole("button", { name: "Bins" }));
    await userEvent.selectOptions(within(screen.getByRole("complementary", { name: "Task" })).getByRole("combobox", { name: "Repeat" }), "daily");
    expect(screen.queryByRole("dialog", { name: "Change" })).not.toBeInTheDocument();
    expect(store.getState().tasks[0]!.repeat).toMatchObject({ start: "2026-11-09", repeat: { frequency: "daily" } });
  });

  it("stores the reminder chosen in the panel", async () => {
    const store = await openApp((s) => s.addTask({ title: "Call", due: "2026-11-09T09:00" }));
    await userEvent.click(await screen.findByRole("button", { name: "Call" }));
    await userEvent.selectOptions(within(screen.getByRole("complementary", { name: "Task" })).getByRole("combobox", { name: "Reminder" }), "15");
    expect(store.getState().tasks[0]!.reminder).toBe(15);
  });

  it("completing a repeating task says when it is next due, and Undo puts it back", async () => {
    const store = await openApp((s) => s.addTask({ title: "Bins", due: "2026-11-09T07:00", repeat: repeatEvery("weekly") }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Complete Bins" }));
    expect(store.getState().tasks[0]!.due).toBe("2026-11-16T07:00");
    expect(screen.getByText(/Done\. Next: Mon 16 Nov 07:00|Done\. Next: 16 Nov 07:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(store.getState().tasks[0]).toMatchObject({ due: "2026-11-09T07:00", completions: [] });
  });

  it("the new task dialog takes a repeat, a reminder and a project", async () => {
    const store = await openApp((s) => {
      const p = s.addProject({ name: "Home", colour: "c3" });
      s.addSection(p.id, "Kitchen");
    });
    await userEvent.click(screen.getByRole("button", { name: "Add a task" }));
    const dialog = screen.getByRole("dialog", { name: "New task" });
    await userEvent.type(within(dialog).getByLabelText("Title"), "Wipe the hob");
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Repeat" }), "weekdays");
    await userEvent.selectOptions(within(dialog).getByLabelText("Reminder"), "5");
    await userEvent.selectOptions(within(dialog).getByLabelText("Project"), store.getState().projects[0]!.id);
    await userEvent.selectOptions(within(dialog).getByLabelText("Section"), store.getState().projects[0]!.sections[0]!.id);
    await userEvent.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(store.getState().tasks[0]).toMatchObject({
      title: "Wipe the hob",
      due: "2026-11-07", // a repeat needs a date, so today
      reminder: 5,
      projectId: store.getState().projects[0]!.id,
      sectionId: store.getState().projects[0]!.sections[0]!.id,
      repeat: { start: "2026-11-07", repeat: { frequency: "weekly", weekdays: ["mon", "tue", "wed", "thu", "fri"] } },
    });
  });
});
