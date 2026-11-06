import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

const NOW = new Date(2026, 10, 7, 10, 0);

async function open() {
  window.history.replaceState(null, "", "/today");
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW });
  await store.ready;
  const errands = store.addList("Errands", "c4");
  act(() => {
    store.addTask({ title: "Book the dentist", listId: errands.id });
    store.addTask({ title: "Buy stamps" });
  });
  render(
    <ClockProvider value={() => NOW}>
      <App store={store} />
    </ClockProvider>,
  );
  return { store, errands };
}

beforeEach(() => vi.unstubAllGlobals());

const options = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("Search or add", () => {
  it("opens with Ctrl+K, finds tasks and lists as you type, and closes with Escape returning focus", async () => {
    await open();
    const field = screen.getByRole("button", { name: "Search or add" });
    field.focus();
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = screen.getByRole("combobox", { name: "Search or add" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "err");
    expect(options()).toEqual(["Errands1 open", "Add task “err”"]);
    await userEvent.clear(input);
    await userEvent.type(input, "dent");
    expect(options()[0]).toBe("Book the dentistErrands");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Search or add" })).not.toBeInTheDocument();
    expect(field).toHaveFocus();
  });

  it("moves with the arrow keys and opens the picked task", async () => {
    const { store } = await open();
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = screen.getByRole("combobox", { name: "Search or add" });
    await userEvent.type(input, "b");
    // Two tasks, the Inbox list, then Add.
    expect(options()).toEqual(["Book the dentistErrands", "Buy stampsInbox", "Inbox1 open", "Add task “b”"]);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getAllByRole("option")[3]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    const panel = await screen.findByRole("complementary", { name: "Task" });
    expect(within(panel).getByRole("textbox", { name: "Title" })).toHaveValue("Buy stamps");
    expect(store.getState().tasks).toHaveLength(2);
  });

  it("offers to add a task in plain words when nothing matches, and Enter adds it", async () => {
    const { store, errands } = await open();
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(screen.getByRole("combobox", { name: "Search or add" }), "call mum friday 3pm #errands !high{Enter}");
    await waitFor(() => expect(store.getState().tasks).toHaveLength(3));
    const added = store.getState().tasks.find((t) => t.title === "call mum")!;
    expect(added).toMatchObject({ due: "2026-11-13T15:00", priority: "high", listId: errands.id });
    expect(screen.queryByRole("dialog", { name: "Search or add" })).not.toBeInTheDocument();
  });

  it("does not offer Add when a task has exactly that title", async () => {
    await open();
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(screen.getByRole("combobox", { name: "Search or add" }), "buy stamps");
    expect(options()).toEqual(["Buy stampsInbox"]);
  });

  it("opens a list on the Lists page", async () => {
    const { errands } = await open();
    await userEvent.click(screen.getByRole("button", { name: "Search or add" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Search or add" }), "errands");
    await userEvent.click(screen.getAllByRole("option")[0]!);
    expect(window.location.pathname).toBe("/lists");
    expect(screen.getByRole("heading", { level: 1, name: "Errands" })).toBeInTheDocument();
    expect(errands.name).toBe("Errands");
  });

  it("keeps Tab inside the dialog", async () => {
    await open();
    await userEvent.keyboard("{Control>}k{/Control}");
    const input = screen.getByRole("combobox", { name: "Search or add" });
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("dialog", { name: "Search or add" }).contains(document.activeElement)).toBe(true);
    expect(input).toBeInTheDocument();
  });
});
