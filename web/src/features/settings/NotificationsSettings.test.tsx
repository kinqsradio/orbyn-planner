import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { PREFS_KEY } from "../../app/prefs";
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

describe("Settings · Notifications", () => {
  it("never asks for permission on load, and says plainly that reminders need the app open", async () => {
    const { request } = stubNotification("default");
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText(/Not asked yet/)).toBeInTheDocument();
    expect(screen.getByText(/only work while Orbyn Planner is open in a browser tab/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Remind me about tasks" })).toHaveAttribute("aria-checked", "false");
  });

  it("says where reminders come from, and draws server push, email reminders and the daily summary as Planned and unavailable", async () => {
    stubNotification("granted");
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    const card = screen.getByText("Server push and email reminders").closest(".card")!;
    const row = (label: string) => screen.getByText(label, { selector: "span" }).closest(".kv")!;
    expect(row("Reminders")).toHaveTextContent("RemindersOn this device");
    expect(row("Server push and email reminders")).toHaveTextContent("Server push and email remindersPlanned Not available yet.");
    expect(row("Daily summary email")).toHaveTextContent("Daily summary emailPlanned Not available yet.");
    expect(card.querySelectorAll(".st.planned")).toHaveLength(2);
    // The planned rows have no control: the one switch is still the real one.
    expect(card.querySelectorAll('[role="switch"]')).toHaveLength(1);
  });

  it("asks when reminders are turned on, and turns them on when allowed", async () => {
    const { request } = stubNotification("default", "granted");
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await userEvent.click(screen.getByRole("switch", { name: "Remind me about tasks" }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("switch", { name: "Remind me about tasks" })).toHaveAttribute("aria-checked", "true");
    expect(prefs().reminders).toBe(true);
    expect(screen.getByText("This browser allows notifications.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Remind me about tasks" }));
    expect(prefs().reminders).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("stays off and explains when permission is refused or already blocked", async () => {
    stubNotification("default", "denied");
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await userEvent.click(screen.getByRole("switch", { name: "Remind me about tasks" }));
    expect(screen.getByRole("switch", { name: "Remind me about tasks" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/blocking notifications/)).toBeInTheDocument();
    expect(prefs().reminders).toBe(false);
  });

  it("says when the browser has no notifications", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("This browser can’t show notifications.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Remind me about tasks" })).toBeDisabled();
  });

  it("saves quiet hours", async () => {
    stubNotification("granted");
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Notifications" }));
    await userEvent.click(screen.getByRole("switch", { name: "Quiet hours" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "21:30" } });
    expect(prefs().quiet).toEqual({ enabled: true, from: "21:30", to: "07:00" });
    expect(screen.getByText(/skipped, not delayed/)).toBeInTheDocument();
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
