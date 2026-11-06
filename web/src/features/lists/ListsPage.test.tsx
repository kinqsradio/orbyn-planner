import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

const NOW = new Date(2026, 10, 7, 10, 0);

async function open(path: string) {
  window.history.replaceState(null, "", path);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW });
  await store.ready;
  render(
    <ClockProvider value={() => NOW}>
      <App store={store} />
    </ClockProvider>,
  );
  return store;
}

beforeEach(() => vi.unstubAllGlobals());

describe("Lists page", () => {
  it("shows Inbox first with open counts, and creates, renames and recolours a list", async () => {
    const store = await open("/lists");
    const inbox = store.getState().lists[0]!;
    act(() => {
      store.addTask({ title: "one" });
      store.addTask({ title: "two" });
      const done = store.addTask({ title: "three" });
      store.setDone(done.id, true);
    });

    const nav = screen.getByRole("navigation", { name: "Your lists" });
    const items = within(nav).getAllByRole("button", { name: /Inbox|Home/ });
    expect(items[0]).toHaveTextContent("Inbox");
    expect(within(items[0]!).getByLabelText("2 open")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "New list" }));
    await userEvent.type(screen.getByRole("textbox", { name: "New list name" }), "Home{Enter}");
    const home = store.getState().lists.find((l) => l.name === "Home")!;
    expect(home.isInbox).toBe(false);
    expect(within(nav).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Inbox2", "Home0"]);

    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    const name = screen.getByRole("textbox", { name: "List name" });
    await userEvent.clear(name);
    await userEvent.type(name, "House{Enter}");
    expect(store.getState().lists.find((l) => l.id === home.id)!.name).toBe("House");

    await userEvent.click(screen.getByRole("radio", { name: "Violet" }));
    expect(store.getState().lists.find((l) => l.id === home.id)!.colour).toBe("c6");

    await userEvent.click(within(nav).getByRole("button", { name: /Inbox/ }));
    expect(screen.getByRole("button", { name: "one" })).toBeInTheDocument();
    expect(inbox.isInbox).toBe(true);
    expect(screen.queryByRole("button", { name: "Rename" })).not.toBeInTheDocument();
  });
});

describe("Completed and deleted page", () => {
  it("lists completed tasks and puts a deleted task back", async () => {
    const store = await open("/completed");
    let b!: { id: string };
    act(() => {
      const a = store.addTask({ title: "finished" });
      store.setDone(a.id, true);
      const binned = store.addTask({ title: "binned" });
      store.deleteTask(binned.id);
      b = binned;
    });

    expect(await screen.findByRole("button", { name: "finished" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Deleted" }));
    expect(screen.getByText("binned")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Put back binned" }));
    expect(store.getState().tasks.find((t) => t.id === b.id)!.deletedAt).toBeNull();
    await waitFor(() => expect(screen.queryByText("binned")).not.toBeInTheDocument());
  });
});
