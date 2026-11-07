import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClockProvider } from "../../app/clock";
import { StoreProvider } from "../../store/context";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { ExportSettings } from "./ExportSettings";

const save = vi.fn();
vi.mock("./save", () => ({ saveFile: (...a: unknown[]) => save(...a) }));

const NOW = new Date("2026-11-07T10:00:00Z");
async function open() {
  const store = new LocalStore({ persistence: new MemoryPersistence(), broadcast: false, now: () => NOW });
  await store.ready;
  render(
    <ClockProvider value={() => NOW}>
      <StoreProvider store={store}>
        <ExportSettings />
      </StoreProvider>
    </ClockProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Export…" }));
  return screen.getByRole("dialog", { name: "Export your data" });
}

beforeEach(() => save.mockReset().mockResolvedValue(true));

describe("the export dialog", () => {
  it("offers JSON and the calendar file as radio rows with their notes, JSON first, Export primary, Cancel focused", async () => {
    const dialog = await open();
    const json = within(dialog).getByRole("radio", { name: /JSON/ });
    const ics = within(dialog).getByRole("radio", { name: /Calendar \(\.ics\)/ });
    expect(json).toBeChecked();
    expect(ics).not.toBeChecked();
    expect(dialog).toHaveTextContent("All your tasks, lists, projects and calendars, as one file.");
    // The calendar file also holds tasks that have a due date, so its note says so rather than "events only".
    expect(dialog).toHaveTextContent("Events, and tasks with a due date, for other calendar apps.");
    expect(within(dialog).getByRole("button", { name: "Export" })).toHaveClass("btn");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  it("while it exports, the button reads Exporting… with a spinner, and the choices and Cancel are disabled", async () => {
    let finish: (v: boolean) => void = () => undefined;
    save.mockReturnValue(new Promise<boolean>((r) => (finish = r)));
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    const busy = within(dialog).getByRole("button", { name: "Exporting…" });
    expect(busy).toBeDisabled();
    expect(busy.querySelector(".spin")).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    for (const radio of within(dialog).getAllByRole("radio")) expect(radio).toBeDisabled();
    await act(async () => finish(true));
  });

  it("when it is done it names the file and its real size, with a Done button", async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    const done = await screen.findByRole("status");
    expect(done).toHaveTextContent(/^Downloaded orbyn-planner-2026-11-07\.json · \d+(\.\d)? (B|kB|MB)$/);
    const [name, , body] = save.mock.calls[0] as [string, string, string];
    expect(name).toBe("orbyn-planner-2026-11-07.json");
    expect(done).toHaveTextContent(new RegExp(`${new Blob([body]).size < 1000 ? new Blob([body]).size + " B" : "kB"}`));
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(done.querySelector(".pv-ok")).not.toBeNull(); // the green check
    expect(screen.getByRole("note")).toHaveTextContent("The exported file isn’t encrypted."); // the warning is kept
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Export…" })).toHaveFocus()); // focus returns to Export…
  });

  it("the calendar file is named by its date and ends in .ics", async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("radio", { name: /Calendar \(\.ics\)/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    await screen.findByRole("status");
    expect(save.mock.calls[0]![0]).toBe("orbyn-planner-2026-11-07.ics");
  });

  it("a failed export says nothing was changed and offers Try again and Cancel", async () => {
    save.mockRejectedValueOnce(new Error("disk"));
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Couldn’t export your data. Nothing was changed.");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(within(dialog).queryAllByRole("radio")).toHaveLength(0); // the failed frame is only the message and its two buttons
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Try again" })).toHaveFocus());
    await userEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Downloaded orbyn-planner-2026-11-07.json");
  });

  it("closing the desktop save dialog is not an export: the choices come back", async () => {
    save.mockResolvedValue(false);
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    await act(async () => undefined);
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Export" })).toBeEnabled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
