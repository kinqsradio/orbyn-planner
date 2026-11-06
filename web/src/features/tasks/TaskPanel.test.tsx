import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { TOAST_MS } from "../../app/ui";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

const NOW = new Date(2026, 10, 7, 10, 0);

async function open(media?: { matches: boolean }) {
  window.history.replaceState(null, "", "/tasks");
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const listeners = new Set<() => void>();
  if (media) {
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }));
  }
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  const task = store.addTask({ title: "water plants", due: "2026-11-09T09:00" });
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  render(
    <ClockProvider value={() => NOW}>
      <App store={store} />
    </ClockProvider>,
    { container: root },
  );
  await userEvent.click(await screen.findByRole("button", { name: "water plants" }));
  return { store, task, listeners, root };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  vi.useRealTimers();
  document.getElementById("root")?.remove();
  document.body.style.overflow = "";
});

describe("task panel saving", () => {
  it("saves notes typed just before Escape", async () => {
    const { store, task } = await open();
    const panel = screen.getByRole("complementary", { name: "Task" });
    await userEvent.type(within(panel).getByRole("textbox", { name: "Notes" }), "Bring the watering can");
    expect(store.getState().tasks.find((t) => t.id === task.id)!.notes).toBe("");
    await userEvent.keyboard("{Escape}");
    expect(store.getState().tasks.find((t) => t.id === task.id)!.notes).toBe("Bring the watering can");
    expect(screen.queryByRole("complementary", { name: "Task" })).not.toBeInTheDocument();
  });

  it("saves the title and notes when the close button is used", async () => {
    const { store, task } = await open();
    const panel = screen.getByRole("complementary", { name: "Task" });
    const title = within(panel).getByRole("textbox", { name: "Title" });
    await userEvent.clear(title);
    await userEvent.type(title, "water the ferns");
    await userEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(store.getState().tasks.find((t) => t.id === task.id)!.title).toBe("water the ferns");
  });

  it("saves half a second after typing stops", async () => {
    const { store, task } = await open();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const panel = screen.getByRole("complementary", { name: "Task" });
    await userEvent.type(within(panel).getByRole("textbox", { name: "Notes" }), "soon", { advanceTimers: vi.advanceTimersByTime });
    expect(store.getState().tasks.find((t) => t.id === task.id)!.notes).toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(store.getState().tasks.find((t) => t.id === task.id)!.notes).toBe("soon");
  });

  it("saves when focus leaves the panel", async () => {
    const { store, task } = await open();
    const panel = screen.getByRole("complementary", { name: "Task" });
    await userEvent.type(within(panel).getByRole("textbox", { name: "Notes" }), "on blur");
    await userEvent.click(screen.getByRole("radio", { name: "Board" }));
    expect(store.getState().tasks.find((t) => t.id === task.id)!.notes).toBe("on blur");
  });

  it("clearing the due date clears the time with it", async () => {
    const { store, task } = await open();
    const panel = screen.getByRole("complementary", { name: "Task" });
    expect(store.getState().tasks.find((t) => t.id === task.id)!.due).toBe("2026-11-09T09:00");
    await userEvent.clear(within(panel).getByLabelText("Due date"));
    expect(store.getState().tasks.find((t) => t.id === task.id)!.due).toBeNull();
  });
});

describe("after Delete", () => {
  it("focus moves to Undo in the toast", async () => {
    await open();
    const panel = screen.getByRole("complementary", { name: "Task" });
    await userEvent.click(within(panel).getByRole("button", { name: "Delete" }));
    const undo = await screen.findByRole("button", { name: "Undo" });
    expect(undo).toHaveFocus();
  });
});

describe("toast", () => {
  it("keeps its live region mounted and changes only the text", async () => {
    await open();
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    await userEvent.click(within(screen.getByRole("complementary", { name: "Task" })).getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Task deleted");
  });

  it("waits while the pointer is on it, and lasts ten seconds", async () => {
    expect(TOAST_MS).toBe(10_000);
    await open();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.click(within(screen.getByRole("complementary", { name: "Task" })).getByRole("button", { name: "Delete" }));
    const toast = screen.getByText("Task deleted").closest(".toast")!;
    await userEvent.hover(toast);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOAST_MS + 5_000);
    });
    expect(screen.getByText("Task deleted")).toBeInTheDocument();
    await userEvent.unhover(toast);
    // Focus is on Undo too, and that also holds the toast.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOAST_MS + 100);
    });
    expect(screen.getByText("Task deleted")).toBeInTheDocument();
    await userEvent.click(document.body);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOAST_MS + 100);
    });
    await waitFor(() => expect(screen.queryByText("Task deleted")).not.toBeInTheDocument());
  });
});

describe("modal dialogs", () => {
  it("lock scrolling and make the app inert while open, and release both on close", async () => {
    const { root } = await open();
    await userEvent.keyboard("{Escape}");
    expect(root).not.toHaveAttribute("inert");
    await userEvent.click(screen.getByRole("button", { name: "Add a task" }));
    const dialog = screen.getByRole("dialog", { name: "New task" });
    expect(root).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    expect(root.contains(dialog)).toBe(false);
    await userEvent.keyboard("{Escape}");
    expect(root).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
  });

  it("the task panel follows the phone breakpoint as it changes", async () => {
    const media = { matches: false };
    const { listeners, root } = await open(media);
    expect(screen.getByRole("complementary", { name: "Task" })).toBeInTheDocument();
    media.matches = true;
    act(() => listeners.forEach((l) => l()));
    const dialog = await screen.findByRole("dialog", { name: "Task" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(root.contains(dialog)).toBe(false);
    expect(root).toHaveAttribute("inert");
    media.matches = false;
    act(() => listeners.forEach((l) => l()));
    expect(await screen.findByRole("complementary", { name: "Task" })).toBeInTheDocument();
    expect(root).not.toHaveAttribute("inert");
  });
});

describe("checklist order", () => {
  it("gives each new step a key after the last and shows steps in key order", async () => {
    const { store, task } = await open();
    const panel = screen.getByRole("complementary", { name: "Task" });
    const add = within(panel).getByRole("textbox", { name: "Add a step" });
    for (const step of ["first", "second", "third"]) await userEvent.type(add, `${step}{Enter}`);
    const steps = store.getState().tasks.find((t) => t.id === task.id)!.checklist;
    expect(steps.map((s) => s.title)).toEqual(["first", "second", "third"]);
    expect(steps.map((s) => s.order)).toEqual(["V", "k", "s"]);
    // Whatever order they are stored in, they show by key.
    act(() => store.updateTask(task.id, { checklist: [steps[2]!, steps[0]!, steps[1]!] }));
    const shown = within(screen.getByRole("complementary", { name: "Task" })).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"));
    expect(shown.filter((l) => ["first", "second", "third"].includes(l!))).toEqual(["first", "second", "third"]);
  });
});

describe("after Undo", () => {
  it("focus returns to the restored row", async () => {
    await open();
    await userEvent.click(within(screen.getByRole("complementary", { name: "Task" })).getByRole("button", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    const row = await screen.findByRole("button", { name: "water plants" });
    await waitFor(() => expect(row).toHaveFocus());
  });
});
