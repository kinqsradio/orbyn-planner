import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClockProvider } from "../../app/clock";
import { StoreProvider } from "../../store/context";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { EXPORT_WARNING, ExportSettings } from "./ExportSettings";

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
    expect(within(dialog).getByRole("radio", { name: /JSON/ }).closest("label")).toHaveTextContent("Everything in your planner, as one file, including events, tags and the trash. Settings stay on this device.");
    // The calendar file also holds tasks that have a due date, so its note says so rather than "events only".
    expect(within(dialog).getByRole("radio", { name: /Calendar \(\.ics\)/ }).closest("label")).toHaveTextContent("Events, and tasks with a due date, for other calendar apps.");
    expect(within(dialog).getByRole("button", { name: "Export" })).toHaveClass("btn");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
  });

  it("while it exports, the button reads Exporting… with a spinner, and the choices and Cancel are disabled", async () => {
    let finish: (v: boolean) => void = () => undefined;
    save.mockReturnValue(new Promise<boolean>((r) => (finish = r)));
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    const busy = within(dialog).getByRole("button", { name: "Exporting…" });
    expect(busy).toHaveAttribute("aria-disabled", "true"); // not `disabled`: a disabled focused button loses focus in a browser
    expect(busy).not.toBeDisabled();
    await userEvent.click(busy);
    expect(save).toHaveBeenCalledTimes(1); // pressing it again does nothing
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

  it("the same warning, in full, shows in the dialog, while it exports and when it is done, and not after a failure", async () => {
    expect(EXPORT_WARNING).toBe("The exported file isn’t encrypted. Anyone who gets it can read it, including the addresses of calendars you subscribe to, which can be private links. Keep it somewhere safe.");
    let finish: (v: boolean) => void = () => undefined;
    save.mockReturnValueOnce(new Promise<boolean>((r) => (finish = r)));
    const dialog = await open();
    expect(within(dialog).getByRole("note")).toHaveTextContent(EXPORT_WARNING);
    await userEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    expect(within(dialog).getByRole("note")).toHaveTextContent(EXPORT_WARNING);
    await act(async () => finish(true));
    expect(await screen.findByRole("note")).toHaveTextContent(EXPORT_WARNING);
  });

  it("a failure hides the warning", async () => {
    save.mockRejectedValueOnce(new Error("disk"));
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    await within(dialog).findByRole("alert");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("focus follows the step even when the browser dropped it: Try again after a failure, Done at the end", async () => {
    let fail: (e: Error) => void = () => undefined;
    save.mockReturnValueOnce(new Promise<boolean>((_r, rej) => (fail = rej)));
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    (document.activeElement as HTMLElement).blur(); // what a browser does to a focused button that has become disabled
    await act(async () => fail(new Error("disk")));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Try again" })).toHaveFocus());
    save.mockResolvedValueOnce(true);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Try again" }));
    (document.activeElement as HTMLElement).blur();
    await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toHaveFocus());
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
