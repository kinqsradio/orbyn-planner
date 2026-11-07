import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

const NOW = new Date(2026, 10, 7, 10, 0);

async function open(path = "/tasks") {
  window.history.replaceState(null, "", path);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  const water = store.addTask({ title: "water plants", due: "2026-11-09T09:00" });
  const mail = store.addTask({ title: "post the parcel", due: "2026-11-10" });
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  render(
    <ClockProvider value={() => NOW}>
      <App store={store} />
    </ClockProvider>,
    { container: root },
  );
  return { store, water, mail };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => document.getElementById("root")?.remove());

const row = (title: string) => screen.getByRole("button", { name: title }).closest("li")!;

describe("tags in the planner", () => {
  it("a task gets tags in its panel (a new one by typing, an existing one from the list), shows them as chips, and the Tasks page filters by tag", async () => {
    const { store, water } = await open();
    await userEvent.click(await screen.findByRole("button", { name: "water plants" }));
    const panel = screen.getByRole("complementary", { name: "Task" });
    await userEvent.type(within(panel).getByRole("textbox", { name: "New tag" }), "Home{Enter}");
    expect(within(panel).getByText("Home")).toBeInTheDocument();
    expect(store.getState().tasks.find((t) => t.id === water.id)!.tags).toHaveLength(1);

    store.addTag("Work", "c1");
    await userEvent.selectOptions(await within(panel).findByRole("combobox", { name: "Add a tag" }), "Work");
    expect(within(row("water plants")).getByText("Home")).toBeInTheDocument();
    expect(within(row("water plants")).getByText("Work")).toBeInTheDocument();
    expect(within(row("post the parcel")).queryByText("Home")).toBeNull();

    await userEvent.click(within(panel).getByRole("button", { name: "Remove tag Work" }));
    expect(within(row("water plants")).queryByText("Work")).toBeNull();

    await userEvent.keyboard("{Escape}");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tag" }), "Home");
    expect(screen.getByRole("button", { name: "water plants" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "post the parcel" })).toBeNull();
  });

  it("Settings · Tags makes, renames and deletes tags; a deleted tag disappears from the tasks, and Restore brings it back", async () => {
    const { store, mail } = await open("/settings");
    const tag = store.addTag("Errands", "c4");
    store.setTaskTag(mail.id, tag.id, true);
    await userEvent.click(await screen.findByRole("button", { name: "Tags" }));
    await userEvent.type(screen.getByRole("textbox", { name: "New tag name" }), "Later{Enter}");
    expect(screen.getByRole("textbox", { name: "Name of tag Later" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "New tag name" }), "later{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("A tag with that name already exists.");
    expect(store.getState().tags.filter((t) => t.name.toLowerCase() === "later")).toHaveLength(1);
    const name = screen.getByRole("textbox", { name: "Name of tag Errands" });
    await userEvent.clear(name);
    await userEvent.type(name, "Shopping{Enter}");
    expect(store.getState().tags.find((t) => t.id === tag.id)!.name).toBe("Shopping");

    await userEvent.click(screen.getByRole("button", { name: "Delete tag Shopping" }));
    expect(screen.getByText(/on 1 task/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Restore tag Shopping" }));
    expect(store.getState().tags.find((t) => t.id === tag.id)!.deletedAt).toBeNull();
    expect(store.getState().tasks.find((t) => t.id === mail.id)!.tags).toEqual([tag.id]);
  });

  it("a task with 100 tags can't be given another: Add a tag and New tag go, and come back when one is removed", async () => {
    const { store, water } = await open();
    const ids = Array.from({ length: 100 }, (_, i) => store.addTag(`Tag ${i}`, "c1").id);
    store.addTag("One more", "c2");
    for (const id of ids) store.setTaskTag(water.id, id, true);
    await userEvent.click(await screen.findByRole("button", { name: "water plants" }));
    const panel = screen.getByRole("complementary", { name: "Task" });
    expect(within(panel).getByText("A task can have 100 tags at most.")).toBeInTheDocument();
    expect(within(panel).queryByRole("combobox", { name: "Add a tag" })).toBeNull();
    expect(within(panel).queryByRole("textbox", { name: "New tag" })).toBeNull();
    await userEvent.click(within(panel).getByRole("button", { name: "Remove tag Tag 0" }));
    expect(within(panel).getByRole("combobox", { name: "Add a tag" })).toBeInTheDocument();
    expect(within(panel).getByRole("textbox", { name: "New tag" })).toBeInTheDocument();
  });
});
