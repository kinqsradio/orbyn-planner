import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClockProvider } from "../../app/clock";
import { PrefsProvider } from "../../app/prefs";
import { UiProvider } from "../../app/ui";
import { StoreProvider } from "../../store/context";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";
import { SettingsPage } from "../settings/SettingsPage";
import { readExport } from "./exportJson";

afterEach(() => vi.unstubAllGlobals());

describe("Settings · Privacy · Export your planner", () => {
  it("says the file isn't encrypted, and downloads the JSON and the calendar file from this device without touching the network", async () => {
    const store = new LocalStore({ persistence: new MemoryPersistence(), broadcast: false, now: () => new Date("2026-11-07T10:00:00Z") });
    await store.ready;
    store.addTask({ title: "Passport", due: "2026-11-20" });
    store.addEvent({ title: "Dentist", start: "2026-11-14T15:00", end: "2026-11-14T16:00" });

    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => (blobs.push(b), `blob:${blobs.length}`));
    URL.revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    render(
      <ClockProvider value={() => new Date("2026-11-07T10:00:00Z")}>
        <UiProvider>
          <PrefsProvider>
            <StoreProvider store={store}>
              <SettingsPage />
            </StoreProvider>
          </PrefsProvider>
        </UiProvider>
      </ClockProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Privacy" }));
    await userEvent.click(screen.getByRole("button", { name: "Export…" }));
    const dialog = screen.getByRole("dialog", { name: "Export your planner" });
    expect(within(dialog).getByText("The file is not encrypted.")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Everything (JSON)" }));
    await waitFor(() => expect(downloads).toEqual(["orbyn-planner-2026-11-07.json"]));
    const exported = readExport(await blobs[0]!.text());
    expect(exported.tasks.map((t) => t.title)).toEqual(["Passport"]);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved orbyn-planner-2026-11-07.json.");

    await userEvent.click(screen.getByRole("button", { name: "Export…" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Calendar (.ics)" }));
    await waitFor(() => expect(downloads).toHaveLength(2));
    expect(downloads[1]).toMatch(/\.ics$/);
    const ics = await blobs[1]!.text();
    expect(ics).toContain("SUMMARY:Dentist");
    expect(ics).toContain("SUMMARY:Passport");
    expect(network).not.toHaveBeenCalled();
  });
});
