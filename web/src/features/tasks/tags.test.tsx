import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import type { Task } from "../../store/types";
import { MemoryPersistence } from "../../store/persistence";

// The panel stops offering tags at MAX_TAGS_PER_TASK. The real limit (100, covered in the store tests) would mean 100 chips on the page in the
// row and the panel, so this file runs with a limit of 3; nothing else here has three tags on a task.
vi.mock("../../store/records", async (original) => ({ ...(await original<typeof import("../../store/records")>()), MAX_TAGS_PER_TASK: 3 }));

const NOW = new Date(2026, 10, 7, 10, 0);

async function open(path = "/tasks", seed?: (store: LocalStore, water: Task) => void) {
  window.history.replaceState(null, "", path);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  const water = store.addTask({ title: "water plants", due: "2026-11-09T09:00" });
  const mail = store.addTask({ title: "post the parcel", due: "2026-11-10" });
  seed?.(store, water); // before the first render, so the page isn't redrawn for every record
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
  it("a task gets a tag by typing a new one in its panel, or by picking an existing one, and shows each as a chip in the panel and its row", async () => {
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
  });

  it("× on a tag chip in the panel removes just that tag", async () => {
    await open("/tasks", (store, task) => {
      store.setTaskTag(task.id, store.addTag("Home", "c2").id, true);
      store.setTaskTag(task.id, store.addTag("Work", "c1").id, true);
    });
    await userEvent.click(await screen.findByRole("button", { name: "water plants" }));
    const panel = screen.getByRole("complementary", { name: "Task" });
    await userEvent.click(within(panel).getByRole("button", { name: "Remove tag Work" }));
    expect(within(row("water plants")).queryByText("Work")).toBeNull();
    expect(within(row("water plants")).getByText("Home")).toBeInTheDocument();
  });

  it("the Tasks page filters by tag", async () => {
    await open("/tasks", (store, task) => {
      store.setTaskTag(task.id, store.addTag("Home", "c2").id, true);
    });
    const home = (await screen.findByRole("combobox", { name: "Tag" })).querySelector("option[value]:not([value=''])") as HTMLOptionElement;
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tag" }), home.value);
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

  it("a task at the tag limit can't be given another: Add a tag and New tag go, and come back when one is removed", async () => {
    // The limit is 100; the panel only compares a count with it, so the page is built with a limit of 3 (see the mock above) and not 100 chips.
    await open("/tasks", (store, water) => {
      for (let i = 0; i < 3; i++) store.setTaskTag(water.id, store.addTag(`Tag ${i}`, "c1").id, true);
      store.addTag("One more", "c2");
    });
    await userEvent.click(await screen.findByText("water plants"));
    const panel = screen.getByLabelText("Task", { selector: "aside" });
    expect(within(panel).getByText("A task can have 3 tags at most.")).toBeInTheDocument();
    expect(within(panel).queryByLabelText("Add a tag")).toBeNull();
    expect(within(panel).queryByLabelText("New tag")).toBeNull();
    await userEvent.click(within(panel).getByLabelText("Remove tag Tag 0"));
    expect(within(panel).getByLabelText("Add a tag")).toBeInTheDocument();
    expect(within(panel).getByLabelText("New tag")).toBeInTheDocument();
  });
});
