import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { groupBySection, projectStats } from "./stats";

// Saturday 7 November 2026, 10:00.
const NOW = new Date(2026, 10, 7, 10, 0);

async function open(path = "/projects", seed?: (s: LocalStore) => { projectId: string } | void) {
  window.history.replaceState(null, "", path);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  const made = seed?.(store);
  if (made && path === "/projects/__") window.history.replaceState(null, "", `/projects/${made.projectId}`);
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

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  document.getElementById("root")?.remove();
});

function seedHome(s: LocalStore) {
  const p = s.addProject({ name: "Home renovation", colour: "c3", goal: "2027-01-30" });
  const kitchen = s.addSection(p.id, "Kitchen");
  const bath = s.addSection(p.id, "Bathroom");
  s.addTask({ title: "Choose kitchen tiles", projectId: p.id, sectionId: kitchen.id, due: "2026-11-09" });
  s.addTask({ title: "Send the deposit", projectId: p.id, sectionId: kitchen.id, due: "2026-11-11" });
  const measured = s.addTask({ title: "Measure the cabinets", projectId: p.id, sectionId: kitchen.id });
  s.setDone(measured.id, true);
  s.addTask({ title: "Get plumbing quotes", projectId: p.id, sectionId: bath.id, due: "2026-11-20" });
  s.addTask({ title: "Order a skip", projectId: p.id });
  return { projectId: p.id, kitchen, bath };
}

describe("stats", () => {
  it("counts progress and finds the next task", async () => {
    const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
    await store.ready;
    const { projectId } = seedHome(store);
    expect(projectStats(store.getState().tasks, projectId)).toMatchObject({ total: 5, done: 1, percent: 20, next: { title: "Choose kitchen tiles" } });
    expect(projectStats(store.getState().tasks, "nothing")).toMatchObject({ total: 0, percent: 0, next: null });
  });

  it("groups by section in order with the loose tasks last, and treats a missing section as none", async () => {
    const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
    await store.ready;
    const { projectId, kitchen } = seedHome(store);
    store.updateTask(store.getState().tasks.find((t) => t.title === "Order a skip")!.id, { sectionId: "gone" });
    const lanes = groupBySection(store.getState().projects[0]!, store.getState().tasks);
    expect(lanes.map((l) => [l.name, l.tasks.length])).toEqual([["Kitchen", 3], ["Bathroom", 1], ["No section", 1]]);
    expect(lanes[0]!.sectionId).toBe(kitchen.id);
    expect(projectId).toBeTruthy();
  });
});

describe("Projects page", () => {
  it("starts empty with a New project action", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
  });

  it("lists projects with their next task, due date and progress, and filters Active and Done", async () => {
    await open("/projects", (s) => {
      seedHome(s);
      const trip = s.addProject({ name: "Summer trip", colour: "c2" });
      s.updateProject(trip.id, { archived: true });
    });
    expect(screen.getByText("1 active")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: "Home renovation" }).closest("li")!;
    expect(within(row).getByText("Choose kitchen tiles")).toBeInTheDocument();
    expect(within(row).getByText("30 Jan 2027")).toBeInTheDocument();
    expect(within(row).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "20");
    expect(screen.queryByRole("button", { name: "Summer trip" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Summer trip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Home renovation" })).not.toBeInTheDocument();
  });

  it("finds a project by name", async () => {
    await open("/projects", (s) => {
      seedHome(s);
      s.addProject({ name: "Spring launch", colour: "c1" });
    });
    await userEvent.type(screen.getByRole("textbox", { name: "Find a project" }), "spring");
    expect(screen.getByRole("button", { name: "Spring launch" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Home renovation" })).not.toBeInTheDocument();
  });

  it("makes a project and opens it", async () => {
    const store = await open();
    await userEvent.click(screen.getAllByRole("button", { name: "New project" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "New project" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Garden");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Orange" }));
    await userEvent.type(within(dialog).getByLabelText("Done by"), "2027-05-01");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add project" }));
    expect(store.getState().projects[0]).toMatchObject({ name: "Garden", colour: "c4", goal: "2027-05-01" });
    expect(window.location.pathname).toBe(`/projects/${store.getState().projects[0]!.id}`);
    expect(await screen.findByRole("heading", { level: 1, name: /Garden/ })).toBeInTheDocument();
  });
});

describe("Project page", () => {
  async function openHome() {
    let ids!: ReturnType<typeof seedHome>;
    const store = await open("/projects/__", (s) => (ids = seedHome(s)));
    return { store, ...ids };
  }

  it("shows sections with their own counts, the tasks, and progress as N of M tasks", async () => {
    await openHome();
    expect(screen.getByRole("heading", { level: 1, name: /Home renovation/ })).toBeInTheDocument();
    expect(screen.getByText(/Due 30 Jan 2027 · 20%/)).toBeInTheDocument();
    const kitchen = screen.getByRole("region", { name: "Kitchen" });
    expect(within(kitchen).getByText("1 of 3")).toBeInTheDocument();
    expect(within(kitchen).getByRole("button", { name: "Choose kitchen tiles" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "No section" })).getByRole("button", { name: "Order a skip" })).toBeInTheDocument();
    expect(screen.getByText("1 of 5 tasks")).toBeInTheDocument();
    expect(screen.getAllByText("Choose kitchen tiles").length).toBeGreaterThan(1); // also as Next
  });

  it("adds, renames, reorders and deletes sections", async () => {
    const { store, kitchen } = await openHome();
    const names = () => screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")).filter((n) => ["Kitchen", "Bathroom", "Garden", "Pantry"].includes(n!));
    await userEvent.type(screen.getByRole("textbox", { name: "New section name" }), "Garden{Enter}");
    expect(names()).toEqual(["Kitchen", "Bathroom", "Garden"]);

    await userEvent.click(screen.getByRole("button", { name: "Move Garden up" }));
    expect(names()).toEqual(["Kitchen", "Garden", "Bathroom"]);
    expect(screen.getByRole("button", { name: "Move Kitchen up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Bathroom down" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Rename Garden" }));
    const field = screen.getByRole("textbox", { name: "Section name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Pantry{Enter}");
    expect(names()).toEqual(["Kitchen", "Pantry", "Bathroom"]);

    await userEvent.click(screen.getByRole("button", { name: "Delete Kitchen" }));
    expect(names()).toEqual(["Pantry", "Bathroom"]);
    const loose = screen.getByRole("region", { name: "No section" });
    expect(within(loose).getByRole("button", { name: "Choose kitchen tiles" })).toBeInTheDocument();
    expect(store.getState().tasks.find((t) => t.title === "Choose kitchen tiles")!.sectionId).toBeNull();
    expect(store.getState().projects[0]!.sections.some((s) => s.id === kitchen.id)).toBe(false);
  });

  it("Board lanes are the sections, with a Done lane, and Move to moves a card", async () => {
    const { store, bath } = await openHome();
    await userEvent.click(screen.getByRole("tab", { name: "Board" }));
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label")).filter((n) => ["Kitchen", "Bathroom", "No section", "Done"].includes(n!))).toEqual(["Kitchen", "Bathroom", "No section", "Done"]);
    expect(within(screen.getByRole("region", { name: "Done" })).getByRole("button", { name: "Measure the cabinets" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Move Choose kitchen tiles to" }));
    const menu = screen.getByRole("menu", { name: "Move Choose kitchen tiles to" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Kitchen", "Bathroom", "No section", "Done"]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Bathroom" }));
    expect(store.getState().tasks.find((t) => t.title === "Choose kitchen tiles")!.sectionId).toBe(bath.id);
    expect(within(screen.getByRole("region", { name: "Bathroom" })).getByRole("button", { name: "Choose kitchen tiles" })).toBeInTheDocument();

    // To Done completes it; from Done into a section reopens it.
    await userEvent.click(screen.getByRole("button", { name: "Move Send the deposit to" }));
    await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Done" }));
    expect(store.getState().tasks.find((t) => t.title === "Send the deposit")!.done).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Move Measure the cabinets to" }));
    await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "No section" }));
    expect(store.getState().tasks.find((t) => t.title === "Measure the cabinets")).toMatchObject({ done: false, sectionId: null });
  });

  it("Calendar shows the project's tasks on the month grid", async () => {
    await openHome();
    await userEvent.click(screen.getByRole("tab", { name: "Calendar" }));
    const cell = document.querySelector('[data-day="2026-11-09"]') as HTMLElement;
    expect(within(cell).getByRole("button", { name: "Choose kitchen tiles" })).toBeInTheDocument();
    expect(screen.getByText("1 task has no date")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("December 2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose kitchen tiles" })).not.toBeInTheDocument();
  });

  it("marks a project done and reopens it, and Add task starts in the project", async () => {
    const { store } = await openHome();
    await userEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(store.getState().projects[0]!.archived).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(store.getState().projects[0]!.archived).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog", { name: "New task" });
    expect(within(dialog).getByLabelText("Project")).toHaveValue(store.getState().projects[0]!.id);
    await userEvent.type(within(dialog).getByLabelText("Title"), "Call the electrician");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(store.getState().tasks.find((t) => t.title === "Call the electrician")!.projectId).toBe(store.getState().projects[0]!.id));
  });

  it("says when the project is not there", async () => {
    await open("/projects/missing");
    expect(await screen.findByRole("heading", { name: "Project not found" })).toBeInTheDocument();
  });

  it("keeps Projects selected in the sidebar on a project page", async () => {
    await openHome();
    expect(within(screen.getByRole("navigation", { name: "Primary" })).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });
});
