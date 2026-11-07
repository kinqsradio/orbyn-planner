import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { PREFS_KEY } from "../../app/prefs";
import { NotificationsLoading, QuietHoursNotSaved } from "./NotificationsSettings";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

const NOW = new Date(2026, 10, 7, 10, 0);

function stubNotification(permission: "default" | "granted" | "denied", answer: "granted" | "denied" = "granted") {
  const shown: { title: string; options?: NotificationOptions }[] = [];
  const request = vi.fn(async () => {
    state.permission = answer;
    return answer;
  });
  const state = { permission } as { permission: string };
  class FakeNotification {
    static get permission() {
      return state.permission;
    }
    static requestPermission = request;
    constructor(title: string, options?: NotificationOptions) {
      shown.push({ title, options });
    }
  }
  vi.stubGlobal("Notification", FakeNotification);
  return { shown, request, state };
}

async function open(path = "/settings", seed?: (s: LocalStore) => void) {
  window.history.replaceState(null, "", path);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  seed?.(store);
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

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  document.getElementById("root")?.remove();
});

const prefs = () => JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");

const open_ = async () => {
  await open();
  await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
};
const reminders = () => screen.getByRole("switch", { name: "Remind me about tasks" });

describe("Settings · Notifications", () => {
  it("off: never asks the browser on load, and says reminders are off on this device", async () => {
    const { request } = stubNotification("default");
    await open_();
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText("Reminders are off on this device.")).toBeInTheDocument();
    expect(reminders()).toHaveAttribute("aria-checked", "false");
  });

  it("draws server push, email reminders, shared-list changes and the daily summary as Planned, with no control", async () => {
    stubNotification("granted");
    await open_();
    const card = screen.getByText("Server push and email reminders").closest(".card")!;
    const row = (label: string) => screen.getByText(label, { selector: "span" }).closest(".kv")!;
    for (const label of ["Server push and email reminders", "When someone changes a shared list", "Daily summary email"]) {
      expect(row(label)).toHaveTextContent(`${label}Planned Not available yet.`);
      expect(row(label).querySelector("button, input")).toBeNull();
    }
    expect(card.querySelectorAll(".st.planned")).toHaveLength(3);
    for (const label of ["Server push and email reminders", "When someone changes a shared list", "Daily summary email"]) {
      expect((row(label) as HTMLElement).style.opacity).toBe("var(--op-planned)"); // dimmed, from a token
      expect(row(label).querySelector(".fine")).not.toBeNull(); // 12px regular
    }
    expect(card.querySelectorAll('[role="switch"]')).toHaveLength(1); // the one real switch
  });

  it("asking: turning it on asks the browser; while the question is open the switch is on and the row says it is waiting", async () => {
    let answer: (v: "granted") => void = () => undefined;
    const { request } = stubNotification("default");
    request.mockImplementation(() => new Promise<"granted">((r) => (answer = r)) as never);
    await open_();
    await userEvent.click(reminders());
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Allow notifications when your browser asks.")).toBeInTheDocument();
    expect(screen.getByText("Waiting for your browser")).toBeInTheDocument();
    expect(reminders()).toHaveAttribute("aria-checked", "true");
    await act(async () => answer("granted"));
    expect(screen.queryByText("Waiting for your browser")).toBeNull();
    expect(prefs().reminders).toBe(true);
    expect(screen.getByText("On this device. Turning it on asks your browser for permission.")).toBeInTheDocument();
    await userEvent.click(reminders());
    expect(prefs().reminders).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("blocked: a warning says where to allow them, the switch is disabled and the row says blocked", async () => {
    stubNotification("denied");
    await open_();
    expect(screen.getByText("Notifications are blocked in your browser. Allow them in the site settings to get reminders.")).toBeInTheDocument();
    expect(screen.getByText("Blocked in this browser.")).toBeInTheDocument();
    expect(reminders()).toBeDisabled();
    expect(reminders()).toHaveClass("on"); // drawn on, as the frame has it
    expect(prefs().reminders).not.toBe(true);
  });

  it("refused when asked: it becomes the blocked state and reminders stay off", async () => {
    stubNotification("default", "denied");
    await open_();
    await userEvent.click(reminders());
    expect(await screen.findByText("Blocked in this browser.")).toBeInTheDocument();
    expect(prefs().reminders).toBe(false);
  });

  it("says when the browser has no notifications", async () => {
    await open_();
    expect(screen.getByText("This browser can’t show notifications.")).toBeInTheDocument();
    expect(reminders()).toBeDisabled();
  });

  it("a Reminders heading sits above the card, the web-only line follows it, and the chip shows the browser's permission", async () => {
    stubNotification("default");
    await open_();
    expect(screen.getByText("Reminders", { selector: "b" })).toBeInTheDocument();
    expect(screen.getByText("Reminders only work while Orbyn Planner is open in a browser tab.")).toBeInTheDocument();
    const chip = () => screen.getByRole("switch", { name: "Remind me about tasks" }).parentElement!.querySelector(".st")!;
    expect(chip()).toHaveTextContent("Not asked yet");
    expect(chip()).not.toHaveClass("ok");
  });

  it("the chip reads Allowed in this browser when allowed, and Blocked in this browser, in amber, when blocked", async () => {
    stubNotification("granted");
    await open_();
    const allowed = screen.getByRole("switch", { name: "Remind me about tasks" }).parentElement!.querySelector(".st")!;
    expect(allowed).toHaveTextContent("Allowed in this browser");
    expect(allowed).toHaveClass("ok");
    document.getElementById("root")?.remove();
    stubNotification("denied");
    await open_();
    const blocked = screen.getByRole("switch", { name: "Remind me about tasks" }).parentElement!.querySelector(".st")!;
    expect(blocked).toHaveTextContent("Blocked in this browser");
    expect(blocked).toHaveClass("warn");
  });

  it("quiet hours: From and Until default to 22:00 and 07:00, and the allow switch is off", async () => {
    stubNotification("granted");
    await open_();
    expect(screen.getByLabelText("From")).toHaveValue("22:00");
    expect(screen.getByLabelText("Until")).toHaveValue("07:00");
    const allow = screen.getByRole("switch", { name: "Allow reminders during quiet hours" });
    expect(allow).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Reminders still fire during quiet hours.")).toBeInTheDocument();
  });

  it("saves the times, and the allow switch turns the skipping off and back on", async () => {
    stubNotification("granted");
    await open_();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "21:30" } });
    expect(prefs().quiet).toEqual({ enabled: true, from: "21:30", to: "07:00" });
    await userEvent.click(screen.getByRole("switch", { name: "Allow reminders during quiet hours" }));
    expect(prefs().quiet.enabled).toBe(false); // allowed: reminders are no longer skipped
    await userEvent.click(screen.getByRole("switch", { name: "Allow reminders during quiet hours" }));
    expect(prefs().quiet.enabled).toBe(true);
  });

  it("an earlier explicit choice of no quiet hours is kept as allowed, and a fresh install has them on", async () => {
    stubNotification("granted");
    localStorage.setItem(PREFS_KEY, JSON.stringify({ quiet: { enabled: false, from: "23:00", to: "06:00" } }));
    await open_();
    expect(screen.getByRole("switch", { name: "Allow reminders during quiet hours" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("From")).toHaveValue("23:00");
  });

  it("the loading frame keeps the labels and the Planned rows, with skeletons for the values", () => {
    render(<NotificationsLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading notifications");
    expect(screen.getByText("Remind me about tasks").closest(".kv")!.querySelector(".skel")).not.toBeNull();
    expect(screen.getByText("Quiet hours", { selector: "span" }).closest(".kv")!.querySelector(".skel")).not.toBeNull();
    expect(screen.getByText("When someone changes a shared list").closest(".kv")).toHaveTextContent("Planned Not available yet.");
  });

  it("a quiet-hours edit that did not save says what did not change, with Discard and Try again", async () => {
    const retry = vi.fn();
    const discard = vi.fn();
    render(<QuietHoursNotSaved saved={{ from: "22:00", to: "07:00" }} onDiscard={discard} onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t save quiet hours. They’re still 22:00 to 07:00 on every device.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledTimes(1);
  });
});

describe("reminders while the app is open", () => {
  async function running(tasks: (s: LocalStore) => void, settings: Record<string, unknown>) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(settings));
    const n = stubNotification("granted");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    const store = await open("/today", tasks);
    return { ...n, store };
  }

  it("shows a notification when a task's reminder comes due", async () => {
    const { shown } = await running((s) => s.addTask({ title: "Call Sam", due: "2026-11-07T10:30", reminder: 15 }), { reminders: true });
    expect(shown).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14 * 60_000);
    });
    expect(shown).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60_000);
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ title: "Call Sam", options: { body: expect.stringContaining("Due") } });
  });

  it("does nothing when reminders are off in Settings", async () => {
    const { shown } = await running((s) => s.addTask({ title: "Call Sam", due: "2026-11-07T10:30", reminder: 15 }), { reminders: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(shown).toEqual([]);
  });

  it("skips a reminder that falls in quiet hours", async () => {
    const { shown } = await running(
      (s) => {
        s.addTask({ title: "Quiet one", due: "2026-11-07T10:30", reminder: 0 });
        s.addTask({ title: "Loud one", due: "2026-11-07T12:00", reminder: 0 });
      },
      { reminders: true, quiet: { enabled: true, from: "10:00", to: "11:00" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 3_600_000);
    });
    expect(shown.map((s) => s.title)).toEqual(["Loud one"]);
  });

  it("fires a reminder inside quiet hours when they are allowed", async () => {
    const { shown } = await running(
      (s) => s.addTask({ title: "Quiet one", due: "2026-11-07T10:30", reminder: 0 }),
      { reminders: true, quiet: { enabled: false, from: "10:00", to: "11:00" } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 3_600_000);
    });
    expect(shown.map((x) => x.title)).toEqual(["Quiet one"]);
  });

  it("picks up a reminder set after the app loaded", async () => {
    const { shown, store } = await running(() => undefined, { reminders: true });
    await act(async () => {
      store.addTask({ title: "Added later", due: "2026-11-07T10:20", reminder: 0 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(21 * 60_000);
    });
    expect(shown.map((s) => s.title)).toEqual(["Added later"]);
  });
});
