import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { TOAST_MS } from "../../app/ui";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

const NOW = new Date(2026, 10, 7, 10, 0);

async function openTasks() {
  window.history.replaceState(null, "", "/tasks");
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW });
  render(
    <ClockProvider value={() => NOW}>
      <App store={store} />
    </ClockProvider>,
  );
  await store.ready;
  const field = screen.getByRole("textbox", { name: "Add a task" });
  await waitFor(() => expect(field).toBeEnabled());
  return { store, field };
}

async function add(field: HTMLElement, text: string) {
  await userEvent.type(field, `${text}{Enter}`);
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.useRealTimers());

describe("Tasks page", () => {
  it("adds a task from plain words", async () => {
    const { field } = await openTasks();
    await add(field, "dentist friday 3pm !high");
    const row = (await screen.findByRole("button", { name: "dentist" })).closest("li")!;
    expect(within(row).getByText("Fri 15:00")).toBeInTheDocument();
    expect(within(row).getByText("High")).toBeInTheDocument();
    expect(field).toHaveValue("");
  });

  it("strikes a completed task through in place", async () => {
    const { field } = await openTasks();
    await add(field, "alpha tomorrow");
    await add(field, "beta");
    const box = await screen.findByRole("checkbox", { name: "Complete alpha" });
    const rows = () => screen.getAllByRole("listitem").map((li) => li.textContent);
    const before = rows();
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(box.closest("li")).toHaveAttribute("data-done", "true");
    expect(rows()).toEqual(before);
  });

  it("deletes with an Undo that brings the task back", async () => {
    const { field, store } = await openTasks();
    await add(field, "water plants");
    await userEvent.click(await screen.findByRole("button", { name: "water plants" }));
    const panel = screen.getByRole("complementary", { name: "Task" });
    await userEvent.click(within(panel).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("button", { name: "water plants" })).not.toBeInTheDocument();
    expect(store.getState().tasks[0]!.deletedAt).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: "water plants" })).toBeInTheDocument();
    expect(store.getState().tasks[0]!.deletedAt).toBeNull();
  });

  it("drops the Undo toast after six seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { field } = await openTasks();
    await add(field, "short lived");
    expect(screen.getByRole("status")).toHaveTextContent("Added");
    await act(async () => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(screen.queryByText(/Added/)).not.toBeInTheDocument();
  });

  it("filters by due date and by list", async () => {
    const { field, store } = await openTasks();
    const errands = store.addList("Errands", "c3");
    await add(field, "one today");
    await add(field, "two tomorrow");
    await add(field, "three #errands");
    await userEvent.click(screen.getByRole("radio", { name: "Today" }));
    expect(screen.getByRole("button", { name: "one" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "two" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Any due date" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "List" }), errands.id);
    expect(screen.getByRole("button", { name: "three" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "one" })).not.toBeInTheDocument();
  });

  it("shows the board lanes", async () => {
    const { field } = await openTasks();
    await add(field, "card");
    await userEvent.click(screen.getByRole("radio", { name: "Board" }));
    expect(within(screen.getByRole("region", { name: "To do" })).getByRole("button", { name: "card" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "List" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Complete card" }));
    await userEvent.click(screen.getByRole("radio", { name: "Board" }));
    expect(within(screen.getByRole("region", { name: "Done" })).getByRole("button", { name: "card" })).toBeInTheDocument();
  });
});
