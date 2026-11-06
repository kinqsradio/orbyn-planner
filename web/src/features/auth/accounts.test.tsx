import { sessionToken } from "../../api/session";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { SIGN_IN_UNAVAILABLE, registerAuthCrypto } from "../../api/authCrypto";
import { createMemoryKeyStore, type KeyStore } from "../../api/keyStore";
import { FakeAuthCrypto } from "../../api/testing/FakeAuthCrypto";
import { createMockEngine, type MockEngine } from "../../api/testing/MockEngine";
import { signOut } from "../../auth/flows";
import { createAuthServices, type AuthServices } from "../../auth/services";
import { deviceName } from "../../auth/deviceName";
import { LocalStore } from "../../store/LocalStore";
import { MemoryPersistence } from "../../store/persistence";

const NOW = new Date(2026, 10, 7, 10, 0);
const SAM = { name: "Sam Rivera", email: "Sam@Example.com", password: "correct horse battery" };
const crypto = new FakeAuthCrypto();

let engine: MockEngine;
/** The clock the server and the devices share; a test moves it to expire an approval. */
let nowMs = NOW.getTime();
/** Fast polling so the tests do not wait; the real schedule is 2 s backing off to 10 s. */
const FAST_POLL = { firstMs: 5, maxMs: 20, totalMs: 5000 };

/** Each browser has a wrapping secret of its own, as each has its own non-extractable key. */
const wraps = new WeakMap<KeyStore, Uint8Array>();
const wrapFor = (keys: KeyStore) => {
  let w = wraps.get(keys);
  if (!w) wraps.set(keys, (w = Uint8Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))));
  return w;
};

function services(keys: KeyStore = createMemoryKeyStore(), useRealCrypto = false, poll = FAST_POLL): AuthServices {
  return createAuthServices({
    wrapSecret: async () => wrapFor(keys).slice(),
    fetch: engine.fetch,
    baseUrl: "http://engine.test",
    keys,
    crypto: useRealCrypto ? undefined : () => crypto,
    now: () => nowMs,
    poll,
  });
}

async function mount(auth: AuthServices, path = "/today") {
  window.history.replaceState(null, "", path);
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  const view = render(
    <ClockProvider value={() => NOW}>
      <App store={store} auth={auth} />
    </ClockProvider>,
    { container: root },
  );
  return {
    root,
    unmount: () => {
      view.unmount();
      root.remove();
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  // The planner's own health check, which the account screens do not use.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
  nowMs = NOW.getTime();
  engine = createMockEngine(() => nowMs);
});
afterEach(() => {
  cleanup();
  document.getElementById("root")?.remove();
  registerAuthCrypto(null);
});

async function fillSignUp(user = SAM) {
  await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await userEvent.type(screen.getByLabelText("Name"), user.name);
  await userEvent.type(screen.getByLabelText("Email"), user.email);
  await userEvent.type(screen.getByLabelText("Password"), user.password);
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
}

async function fillSignIn(email = SAM.email, password = SAM.password) {
  await userEvent.type(await screen.findByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

const todayShown = () => screen.findByRole("heading", { name: "Nothing planned yet" });
const openAccount = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "Account" }));
};

describe("the public pages", () => {
  it("shows the landing page when signed out, and the planner works without an account", async () => {
    await mount(services());
    expect(await screen.findByRole("heading", { name: /Your tasks and calendar/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use without an account" }));
    await todayShown();
    expect(localStorage.getItem("orbyn-planner.local-only")).toBe("1");
    expect(engine.calls).toEqual([]);
  });

  it("remembers the choice to go on without an account", async () => {
    const first = await mount(services());
    await userEvent.click(await screen.findByRole("button", { name: "Use without an account" }));
    await todayShown();
    first.unmount();
    await mount(services());
    await todayShown();
  });

  it("Settings · Account offers sign-in when there is no account, and the sign-in screens open over the planner", async () => {
    await mount(services(), "/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Use without an account" }));
    await openAccount();
    expect(screen.getByText("This device only")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("form", { name: "Sign in" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to the planner" }));
    expect(screen.getByText("This device only")).toBeInTheDocument();
  });

  it("the Can’t sign in page offers approval from a trusted device and says the rest is not ready", async () => {
    await mount(services());
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await userEvent.click(screen.getByRole("button", { name: "Can’t sign in?" }));
    const group = screen.getByRole("group", { name: "Can’t sign in?" });
    expect(within(group).getByText("Approve from a trusted device")).toBeInTheDocument();
    expect(within(group).getAllByText("Not available yet.")).toHaveLength(3);
    await userEvent.click(within(group).getByRole("button", { name: "Back to sign in" }));
    expect(screen.getByRole("form", { name: "Sign in" })).toBeInTheDocument();
  });

  it("says plainly that sign-in is not in this build, and sends nothing", async () => {
    registerAuthCrypto(null);
    await mount(services(createMemoryKeyStore(), true));
    await fillSignUp();
    expect(await screen.findByRole("alert")).toHaveTextContent(`${SIGN_IN_UNAVAILABLE}.`);
    expect(engine.calls).toEqual([]);
    expect(screen.queryByRole("heading", { name: "Nothing planned yet" })).not.toBeInTheDocument();
  });
});

describe("sign up", () => {
  it("creates the account, signs this device in as its trusted first device and opens the planner", async () => {
    const auth = services();
    await mount(auth);
    await fillSignUp();
    await todayShown();
    expect(engine.calls.map((c) => `${c.method} ${c.path}`).slice(0, 2)).toEqual(["POST /v1/accounts/register/start", "POST /v1/accounts/register/finish"]);
    const finish = engine.calls[1]!.body as { email: string; device: { platform: string; name: string } };
    expect(finish.email).toBe("sam@example.com"); // trimmed and lowercased
    expect(finish.device).toMatchObject({ platform: "web", name: deviceName() });
    const session = auth.tokens.getSession()!;
    expect(session).toMatchObject({ email: "sam@example.com", name: "Sam Rivera", deviceState: "trusted" });
    expect(await auth.keys.loadSession()).toEqual(session); // kept for a reload
    expect(await auth.keys.loadKeys()).not.toBeNull();
    expect(localStorage.getItem("orbyn-planner.local-only")).toBeNull();
  });

  it("needs a password of 8 characters", async () => {
    await mount(services());
    await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
    await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "short");
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  });

  it("an email that is taken says so", async () => {
    const first = await mount(services());
    await fillSignUp();
    await todayShown();
    first.unmount();
    await mount(services());
    await fillSignUp();
    expect(await screen.findByRole("alert")).toHaveTextContent("That email can’t be used for a new account");
  });

  it("an invalid email is refused before anything is sent", async () => {
    await mount(services());
    await fillSignUp({ ...SAM, email: "not an email" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid email address.");
    expect(engine.calls).toEqual([]);
  });

  it("a session that has expired sends the person back to the landing page on the next visit", async () => {
    const keys = createMemoryKeyStore();
    const first = await mount(services(keys));
    await fillSignUp();
    await todayShown();
    first.unmount();
    await keys.saveSession({ ...(await keys.loadSession())!, expiresAt: "2026-01-01T00:00:00.000Z" });
    await mount(services(keys));
    expect(await screen.findByRole("heading", { name: /Your tasks and calendar/ })).toBeInTheDocument();
  });
});

describe("sign in", () => {
  async function accountWithSignedOutBrowser() {
    const keys = createMemoryKeyStore();
    const first = await mount(services(keys));
    await fillSignUp();
    await todayShown();
    first.unmount();
    await keys.clearSession(); // signed out; the device keeps its keys
    return keys;
  }

  it("a wrong password gets a plain message and the second request is never sent", async () => {
    await accountWithSignedOutBrowser();
    await mount(services());
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn(SAM.email, "wrong wrong wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don’t match.");
    expect(engine.calls.some((c) => c.path === "/v1/sessions/login/finish")).toBe(false);
    expect(screen.queryByRole("heading", { name: "Nothing planned yet" })).not.toBeInTheDocument();
  });

  it("an unknown email looks exactly like a wrong password", async () => {
    await mount(services());
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn("nobody@example.com", "whatever whatever");
    expect(await screen.findByRole("alert")).toHaveTextContent("That email and password don’t match.");
  });

  it("too many attempts says to wait", async () => {
    await mount(services());
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    engine.refuseNext("/v1/sessions/login/start", 429, "too_many_attempts");
    await fillSignIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts. Wait a little while, then try again.");
  });

  it("a browser that is already trusted signs in with its proof and goes straight to the planner", async () => {
    const keys = await accountWithSignedOutBrowser();
    const auth = services(keys);
    await mount(auth);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn();
    await todayShown();
    expect(engine.state.trustedProofs).toBe(1);
    const start = engine.calls.filter((c) => c.path === "/v1/sessions/login/start").at(-1)!.body as { trusted_device?: { signed_at: number } };
    expect(start.trusted_device?.signed_at).toBe(Math.floor(NOW.getTime() / 1000));
    expect(auth.tokens.getSession()?.deviceState).toBe("trusted");
    expect(sessionToken()).toBe(auth.tokens.getSession()?.token);
  });

  describe("a browser that holds another account's keys", () => {
    async function withOtherAccount() {
      const keys = await accountWithSignedOutBrowser(); // Sam's trusted keys stay in this browser
      const other = createMemoryKeyStore();
      const elsewhere = await mount(services(other));
      await fillSignUp({ name: "Alex", email: "alex@example.com", password: "another long password" });
      await todayShown();
      elsewhere.unmount();
      return keys;
    }
    const startOf = () => engine.calls.filter((c) => c.path === "/v1/sessions/login/start");

    it("asks first, sends nothing on Cancel, and keeps the keys", async () => {
      const keys = await withOtherAccount();
      const before = await keys.loadKeys();
      const sent = engine.calls.length;
      await mount(services(keys));
      await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
      await fillSignIn("alex@example.com", "another long password");
      const dialog = await screen.findByRole("alertdialog", { name: "Sign in to a different account" });
      expect(dialog).toHaveTextContent("s•••@e•••.com");
      expect(dialog).toHaveTextContent("removes them from this browser");
      expect(engine.calls.length).toBe(sent);
      await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
      expect(engine.calls.length).toBe(sent);
      expect(await keys.loadKeys()).toEqual(before);
    });

    it("Sign in anyway signs in with new keys and no proof from the old ones", async () => {
      const keys = await withOtherAccount();
      const before = await keys.loadKeys();
      await mount(services(keys));
      await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
      await fillSignIn("alex@example.com", "another long password");
      await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sign in anyway" }));
      await screen.findByRole("heading", { name: "Approve this device" });
      expect((startOf().at(-1)!.body as { trusted_device?: unknown }).trusted_device).toBeUndefined();
      expect(await keys.loadKeys()).not.toEqual(before);
      expect((await keys.loadIdentity())?.email).toBe("alex@example.com");
    });

    it("a wrong password after Sign in anyway leaves the old keys alone", async () => {
      const keys = await withOtherAccount();
      const before = await keys.loadKeys();
      await mount(services(keys));
      await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
      await fillSignIn("alex@example.com", "wrong wrong wrong");
      await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sign in anyway" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("don’t match");
      expect(await keys.loadKeys()).toEqual(before);
      expect((await keys.loadIdentity())?.email).toBe("sam@example.com");
    });
  });

  it("a new browser signs in as a pending device and waits for approval", async () => {
    await accountWithSignedOutBrowser();
    const second = services();
    await mount(second);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn();
    expect(await screen.findByRole("heading", { name: "Approve this device" })).toBeInTheDocument();
    expect(await screen.findByText("Waiting for a trusted device to approve this one.")).toBeInTheDocument();
    expect(second.tokens.getSession()?.deviceState).toBe("pending");
    expect(sessionToken()).toBeNull();
    expect(engine.state.trustedProofs).toBe(0);
    // The planner behind it is not open.
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  });
});

describe("adding a device", () => {
  /** A is signed up; B has signed in and waits. */
  async function twoDevices() {
    const keysA = createMemoryKeyStore();
    const keysB = createMemoryKeyStore();
    const a = services(keysA);
    const b = services(keysB);
    const first = await mount(a);
    await fillSignUp();
    await todayShown();
    first.unmount();
    const second = await mount(b);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn();
    await screen.findByRole("heading", { name: "Approve this device" });
    second.unmount();
    return { a, b };
  }

  /** A shows the dialog for B; both are mounted at once so they can poll each other. */
  async function bothMounted() {
    const { a, b } = await twoDevices();
    const onA = await mount(a, "/settings");
    await openAccount();
    const list = await screen.findByRole("list", { name: "Devices" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    expect(within(list).getByText(/this device/)).toBeInTheDocument();
    expect(within(list).getByText("Waiting for approval")).toBeInTheDocument();
    const onB = await mount(b);
    await userEvent.click(within(list).getByRole("button", { name: `Approve ${deviceName()}` }));
    const dialog = screen.getByRole("dialog", { name: "New sign-in" });
    return { a, b, onA, onB, dialog, onDevice: within(onB.root) };
  }

  /** Both screens show the digits. */
  async function compared() {
    const t = await bothMounted();
    const sasA = (await within(t.dialog).findByTestId("approval-code")).textContent;
    const sasB = (await t.onDevice.findByTestId("approval-code")).textContent;
    return { ...t, sasA, sasB };
  }

  const confirmCalls = () => engine.calls.filter((c) => c.path.endsWith("/confirm")).length;
  const createCalls = () => engine.calls.filter((c) => c.method === "POST" && c.path === "/v1/devices/approvals").length;

  it("both devices show the same six digits, the key fingerprint is on the trusted one, and nothing is approved until They match", async () => {
    const { a, b, dialog, sasA, sasB, onDevice } = await compared();
    expect(sasA).toMatch(/^\d{3} \d{3}$/);
    expect(sasB).toBe(sasA);
    expect(within(dialog).getByTestId("fingerprint").textContent).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
    // The server holds only a commitment so far: no confirm, and the new device is still pending.
    expect(confirmCalls()).toBe(0);
    expect([...engine.accounts.values()][0]!.devices.find((d) => d.state === "pending")).toBeDefined();
    const commit = engine.calls.find((c) => c.method === "POST" && c.path === "/v1/devices/approvals")!.body as Record<string, unknown>;
    expect(Object.keys(commit).sort()).toEqual(["approval_id", "commitment", "created_at", "device_id"]);

    await userEvent.click(within(dialog).getByRole("button", { name: "They match" }));
    expect(await within(dialog).findByText(/Waiting for .* to confirm/)).toBeInTheDocument();
    expect(confirmCalls()).toBe(1);
    // The new device is not trusted until its own person confirms.
    expect([...engine.accounts.values()][0]!.devices.filter((d) => d.state === "trusted")).toHaveLength(1);
    await userEvent.click(onDevice.getByRole("button", { name: "They match" }));
    expect(await within(dialog).findByText(/is trusted/)).toBeInTheDocument();
    expect(await onDevice.findByText("This device is trusted.")).toBeInTheDocument();
    await userEvent.click(onDevice.getByRole("button", { name: "Continue" }));
    expect(await onDevice.findByRole("heading", { name: "Nothing planned yet" })).toBeInTheDocument();
    expect(b.tokens.getSession()?.deviceState).toBe("trusted");
    expect((await b.keys.loadSession())?.deviceState).toBe("trusted");
    void a;
  });

  it("a device approved by another is shown as trusting it after a reload, because its engine state was saved", async () => {
    const { b, dialog, onDevice, onA, onB } = await compared();
    await userEvent.click(within(dialog).getByRole("button", { name: "They match" }));
    await userEvent.click(onDevice.getByRole("button", { name: "They match" }));
    await userEvent.click(await onDevice.findByRole("button", { name: "Continue" }));
    await onDevice.findByRole("heading", { name: "Nothing planned yet" });
    const sealed = await b.keys.loadSnapshot();
    expect(sealed).not.toBeNull();
    onA.unmount();
    onB.unmount();

    // A page load later: the saved state says who this device pinned after the digits matched.
    const reloaded = services(b.keys);
    const open = async () => {
      const view = await mount(reloaded, "/settings");
      await openAccount();
      const list = await screen.findByRole("list", { name: "Devices" });
      await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
      return { view, list };
    };
    const first = await open();
    expect(within(first.list).queryAllByRole("button", { name: /^Approve/ })).toHaveLength(0);
    expect(within(first.list).queryByText("Needs approving again")).not.toBeInTheDocument();
    first.view.unmount();

    // Without the saved state the other device would look untrusted.
    await b.keys.clearSnapshot();
    const second = await open();
    await waitFor(() => expect(within(second.list).getAllByRole("button", { name: /^Approve/ })).toHaveLength(1));
  });

  it("the new device can type the digits instead of tapping", async () => {
    const { dialog, sasA, onDevice } = await compared();
    await userEvent.click(within(dialog).getByRole("button", { name: "They match" }));
    await userEvent.click(onDevice.getByRole("button", { name: "Type the code instead" }));
    await userEvent.type(onDevice.getByLabelText("6-digit code on the other device"), sasA!);
    await userEvent.click(onDevice.getByRole("button", { name: "Continue" }));
    expect(await onDevice.findByText("This device is trusted.")).toBeInTheDocument();
  });

  it("a mismatch closes the approval for both: typed digits that differ, then Start again needs a new approval", async () => {
    const { dialog, sasA, onDevice } = await compared();
    await userEvent.click(within(dialog).getByRole("button", { name: "They match" }));
    await userEvent.click(onDevice.getByRole("button", { name: "Type the code instead" }));
    const wrong = sasA!.replace(" ", "") === "000000" ? "111111" : "000000";
    await userEvent.type(onDevice.getByLabelText("6-digit code on the other device"), wrong);
    await userEvent.click(onDevice.getByRole("button", { name: "Continue" }));
    expect(await onDevice.findByRole("alert")).toHaveTextContent("digits didn’t match");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("was closed");
    expect([...engine.accounts.values()][0]!.devices.filter((d) => d.state === "trusted")).toHaveLength(1);

    // One attempt per approval: a new one is made, and its digits are new.
    const created = createCalls();
    await userEvent.click(within(dialog).getByRole("button", { name: "Start again" }));
    await userEvent.click(onDevice.getByRole("button", { name: "Start again" }));
    await waitFor(() => expect(createCalls()).toBe(created + 1));
    const again = within(screen.getByRole("dialog", { name: "New sign-in" }));
    expect((await again.findByTestId("approval-code")).textContent).toMatch(/^\d{3} \d{3}$/);
    expect((await onDevice.findByTestId("approval-code")).textContent).toBe(again.getByTestId("approval-code").textContent);
  });

  it("Cancel on the trusted device closes it for the new one, which can start again", async () => {
    const { dialog, onDevice } = await compared();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("cancelled");
    expect(await onDevice.findByRole("alert")).toHaveTextContent("was closed");
    expect(confirmCalls()).toBe(0);
    expect(engine.calls.some((c) => c.path.endsWith("/cancel"))).toBe(true);
    expect(onDevice.getByRole("button", { name: "Start again" })).toBeInTheDocument();
  });

  it("Cancel on the new device closes it for the trusted one", async () => {
    const { dialog, onDevice } = await compared();
    await userEvent.click(onDevice.getByRole("button", { name: "Cancel" }));
    expect(await onDevice.findByRole("alert")).toHaveTextContent("cancelled");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("was closed");
    expect(within(dialog).getByRole("button", { name: "Start again" })).toBeInTheDocument();
  });

  it("an approval left for ten minutes runs out: the trusted device is told when it confirms", async () => {
    const { dialog, onDevice } = await compared();
    nowMs += 11 * 60_000;
    await userEvent.click(within(dialog).getByRole("button", { name: "They match" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("ran out of time");
    expect(within(dialog).getByRole("button", { name: "Start again" })).toBeInTheDocument();
    expect(await onDevice.findByRole("alert")).toHaveTextContent("ran out of time");
  });

  it("the trusted device gives up waiting for a new device that never shows up", async () => {
    const { a } = await twoDevices();
    const short = services(createMemoryKeyStore(), false, { firstMs: 5, maxMs: 10, totalMs: 60 });
    // Same keys as A, a short patience; no new device is mounted, so nothing joins.
    const withKeys = createAuthServices({ fetch: engine.fetch, baseUrl: "http://engine.test", keys: a.keys, crypto: () => crypto, now: () => nowMs, wrapSecret: async () => wrapFor(a.keys).slice(), poll: { firstMs: 5, maxMs: 10, totalMs: 60 } });
    void short;
    await mount(withKeys, "/settings");
    await openAccount();
    await userEvent.click(await screen.findByRole("button", { name: `Approve ${deviceName()}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ran out of time");
  });

  it("a refused approval is explained and Start again tries once more", async () => {
    const { a } = await twoDevices();
    await mount(a, "/settings");
    await openAccount();
    engine.refuseNext("/v1/devices/approvals", 429, "too_many_attempts");
    await userEvent.click(await screen.findByRole("button", { name: `Approve ${deviceName()}` }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
    await userEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(await screen.findByText(/Waiting for .* to show its code/)).toBeInTheDocument();
  });

  it("Add a device explains the steps", async () => {
    await mount(services(), "/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
    await userEvent.type(screen.getByLabelText("Email"), SAM.email);
    await userEvent.type(screen.getByLabelText("Password"), SAM.password);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await openAccount();
    await userEvent.click(await screen.findByRole("button", { name: "Add a device" }));
    expect(within(screen.getByRole("dialog", { name: "Add a device" })).getByText(/sign in with your email and password/)).toBeInTheDocument();
  });

  it("removing a device asks first, and the list updates", async () => {
    const { a } = await twoDevices();
    await mount(a, "/settings");
    await openAccount();
    const list = await screen.findByRole("list", { name: "Devices" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    await userEvent.click(within(list).getByRole("button", { name: `Remove ${deviceName()}` }));
    const dialog = screen.getByRole("dialog", { name: "Remove device" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(within(list).getByRole("button", { name: `Remove ${deviceName()}` }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Remove device" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Devices" })).getAllByRole("listitem")).toHaveLength(1));
    // This device has no Remove: that is Sign out.
    expect(screen.queryByRole("button", { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it("the last trusted device is refused with a plain message", async () => {
    const { a } = await twoDevices();
    await mount(a, "/settings");
    await openAccount();
    await userEvent.click(await screen.findByRole("button", { name: `Remove ${deviceName()}` }));
    engine.refuseNext("/v1/devices/0", 409, "last_trusted_device", "The last trusted device cannot be removed.");
    await userEvent.click(within(screen.getByRole("dialog", { name: "Remove device" })).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This is your last trusted device. Approve another device first, then remove this one.");
    expect(screen.getByRole("dialog", { name: "Remove device" })).toBeInTheDocument();
  });
});

describe("removing a device and approving one again", () => {
  /** A is signed up; C is a device the server lists as trusted but A never approved (stranded), with a session of its own. */
  async function withStranded() {
    const keysA = createMemoryKeyStore();
    const a = services(keysA);
    const first = await mount(a);
    await fillSignUp();
    await todayShown();
    first.unmount();
    const account = [...engine.accounts.values()][0]!;
    const keysC = createMemoryKeyStore();
    const material = crypto.deviceKeys.create();
    await keysC.saveKeys(material.export(wrapFor(keysC).slice()));
    const old = {
      id: "00000000-0000-4000-8000-0000000000c1", name: "Old phone", platform: "ios" as const, state: "trusted" as const, signing_key: material.signingKey(),
      agreement_key: material.agreementKey(), created_at: new Date(NOW.getTime() - 86_400_000).toISOString(), approved_by: null, approval_signature: null, current: false,
    };
    account.devices.push(old);
    engine.sessions.set("token-c", { accountId: account.id, deviceId: old.id });
    const c = services(keysC);
    await c.tokens.set({ token: "token-c", accountId: account.id, deviceId: old.id, deviceState: "trusted", expiresAt: new Date(NOW.getTime() + 86_400_000).toISOString(), email: "sam@example.com", name: "" });
    return { a, c, old, account };
  }

  it("removing sends the sequence and signature the engine asks for, one above what was counted", async () => {
    const { a, account } = await withStranded();
    const second = { ...account.devices[1]!, id: "00000000-0000-4000-8000-0000000000c2", name: "Tablet" };
    account.devices.push(second);
    await mount(a, "/settings");
    await openAccount();
    await userEvent.click(await screen.findByRole("button", { name: "Remove Old phone" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Remove device" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(engine.calls.filter((c) => c.method === "DELETE" && c.path.startsWith("/v1/devices/"))).toHaveLength(1));
    const first = engine.calls.find((c) => c.method === "DELETE" && c.path.startsWith("/v1/devices/"))!.body as { sequence: number; signature: string };
    expect(first.sequence).toBe(1);
    expect(first.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(account.removals).toHaveLength(1);
    await userEvent.click(await screen.findByRole("button", { name: "Remove Tablet" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Remove device" })).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(account.removals).toHaveLength(2));
    // The list now carries the first removal, which the device counts before it signs the next.
    expect(account.removals![1]!.sequence).toBe(2);
  });

  it("a device this one doesn't verify is offered for approval again, whatever the server calls it", async () => {
    const { a } = await withStranded();
    await mount(a, "/settings");
    await openAccount();
    const list = await screen.findByRole("list", { name: "Devices" });
    await waitFor(() => expect(within(list).getByText("Needs approving again")).toBeInTheDocument());
    expect(within(list).getByRole("button", { name: "Approve Old phone again" })).toBeInTheDocument();
    // This device itself is never offered.
    expect(within(list).getAllByRole("button", { name: /^Approve/ })).toHaveLength(1);
  });

  const nonceCalls = () => engine.calls.filter((c) => c.method === "POST" && c.path.endsWith("/nonce")).length;

  it("a trusted device is only told, and joins nothing until the person taps Approve this device again", async () => {
    const { a, c, account } = await withStranded();
    await mount(a, "/settings");
    await openAccount();
    const onC = await mount(c);
    const device = within(onC.root);
    await userEvent.click(await screen.findByRole("button", { name: "Approve Old phone again" }));
    const dialog = screen.getByRole("dialog", { name: "New sign-in" });
    // C sees a passive notice over its planner.
    const notice = await screen.findByRole("status", { name: "Approval request" });
    expect(notice).toHaveTextContent("Another device asked to approve this one again");
    expect(await device.findByRole("heading", { name: "Nothing planned yet" })).toBeInTheDocument();
    expect(device.queryByRole("heading", { name: "Approve this device again" })).not.toBeInTheDocument();
    // Time passes: still nothing joined, no nonce sent, and the trusted device is still waiting for it.
    await new Promise((r) => setTimeout(r, 150));
    expect(nonceCalls()).toBe(0);
    expect(within(dialog).queryByTestId("approval-code")).not.toBeInTheDocument();

    await userEvent.click(within(notice).getByRole("button", { name: "Approve this device again" }));
    const sasA = (await within(dialog).findByTestId("approval-code")).textContent;
    expect(nonceCalls()).toBe(1);
    expect(await device.findByRole("heading", { name: "Approve this device again" })).toBeInTheDocument();
    expect((await device.findByTestId("approval-code")).textContent).toBe(sasA);
    await userEvent.click(within(dialog).getByRole("button", { name: "They match" }));
    await userEvent.click(device.getByRole("button", { name: "They match" }));
    expect(await device.findByText("This device is trusted.")).toBeInTheDocument();
    await userEvent.click(device.getByRole("button", { name: "Continue" }));
    expect(await device.findByRole("heading", { name: "Nothing planned yet" })).toBeInTheDocument();
    // The server's record of how the device was approved is replaced by this approval.
    expect(account.devices.find((d) => d.name === "Old phone")).toMatchObject({ state: "trusted", approval_signature: expect.any(String) });
  });

  it("dismissing the notice hides it for that approval and sends nothing", async () => {
    const { a, c } = await withStranded();
    await mount(a, "/settings");
    await openAccount();
    const onC = await mount(c);
    await userEvent.click(await screen.findByRole("button", { name: "Approve Old phone again" }));
    const notice = await screen.findByRole("status", { name: "Approval request" });
    await userEvent.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status", { name: "Approval request" })).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 150)); // it keeps polling, and stays hidden
    expect(screen.queryByRole("status", { name: "Approval request" })).not.toBeInTheDocument();
    expect(nonceCalls()).toBe(0);
    void onC;
  });
});

describe("signing out", () => {
  async function signedIn(path = "/settings") {
    const auth = services();
    await mount(auth, path);
    await fillSignUp();
    await screen.findByRole("navigation", { name: "Primary" });
    return auth;
  }

  it("Sign out ends the session on the server and here, and shows the landing page", async () => {
    const auth = await signedIn();
    await openAccount();
    await waitFor(async () => expect(await auth.keys.loadSnapshot()).not.toBeNull()); // opening Account made the engine's state
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: /Your tasks and calendar/ })).toBeInTheDocument();
    const out = engine.calls.find((c) => c.method === "DELETE" && c.path === "/v1/sessions/current")!;
    expect(out.authorization).toMatch(/^Bearer token-/);
    expect(auth.tokens.token()).toBeNull();
    expect(await auth.keys.loadSession()).toBeNull();
    expect(await auth.keys.loadKeys()).toBeNull(); // signing out forgets the device: keys, snapshot and wrapping key
    expect(await auth.keys.loadSnapshot()).toBeNull();
    expect(await auth.keys.loadWrapKey()).toBeNull();
  });

  it("a 401 on a signed-in call clears the token and signs the person out", async () => {
    const auth = await signedIn();
    await openAccount();
    await screen.findByRole("list", { name: "Devices" });
    engine.expireAllSessions();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("heading", { name: /Your tasks and calendar/ })).toBeInTheDocument();
    expect(auth.tokens.token()).toBeNull();
    expect(await auth.keys.loadSession()).toBeNull();
    // An ended session is not a forgotten device: the keys and their saved state stay for the next sign-in.
    expect(await auth.keys.loadKeys()).not.toBeNull();
    expect(await auth.keys.loadSnapshot()).not.toBeNull();
  });

  it("if the device can't be forgotten the person is told, and is still signed out", async () => {
    const auth = await signedIn();
    await openAccount();
    auth.keys.clearDevice = async () => {
      throw new Error("blocked");
    };
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("saved keys couldn’t be removed");
    expect(auth.tokens.token()).toBeNull();
  });

  it("saved state that can't be read is quarantined and the person is told in Settings", async () => {
    const auth = await signedIn();
    await openAccount();
    await waitFor(async () => expect(await auth.keys.loadSnapshot()).not.toBeNull());
    const stranger = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    await auth.keys.saveSnapshot(stranger);
    await userEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    const notice = await screen.findByText(/saved trust state couldn’t be used/);
    expect(notice).toBeInTheDocument();
    expect(await auth.keys.loadQuarantine()).toEqual([stranger]);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/saved trust state couldn’t be used/)).not.toBeInTheDocument();
  });

  it("the quarantine notice shows after a reload and when another tab quarantines", async () => {
    const auth = await signedIn();
    await openAccount();
    await waitFor(async () => expect(await auth.keys.loadSnapshot()).not.toBeNull());
    expect(screen.queryByText(/saved trust state couldn’t be used/)).not.toBeInTheDocument();
    // Another tab of this browser, over the same stored state, finds the snapshot unreadable.
    const otherTab = createAuthServices({
      fetch: engine.fetch, baseUrl: "http://engine.test", keys: auth.keys, crypto: () => crypto, now: () => nowMs, poll: FAST_POLL, wrapSecret: async () => wrapFor(auth.keys).slice(),
    });
    await auth.keys.saveSnapshot(new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9, 9, 9]));
    await otherTab.engine.run(auth.tokens.getSession()!, () => 1);
    expect(await screen.findByText(/saved trust state couldn’t be used/)).toBeInTheDocument();
    // A reload: a new page over the same store shows it with nothing else happening.
    cleanup();
    await mount(services(auth.keys), "/settings");
    await openAccount();
    expect(await screen.findByText(/saved trust state couldn’t be used/)).toBeInTheDocument();
  });

  it("signing out in another tab signs this one out too", async () => {
    await signedIn("/today");
    await todayShown();
    const elsewhere = services(); // another tab: its own page state, the same browser channel
    await signOut(elsewhere);
    expect(await screen.findByRole("heading", { name: /Your tasks and calendar/ })).toBeInTheDocument();
  });

  it("after a 401 a person who chose no account goes back to the planner on this device", async () => {
    localStorage.setItem("orbyn-planner.local-only", "1");
    const auth = services();
    await mount(auth, "/settings");
    await openAccount();
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    await userEvent.type(screen.getByLabelText("Email"), SAM.email);
    await userEvent.type(screen.getByLabelText("Password"), SAM.password);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByRole("list", { name: "Devices" });
    engine.expireAllSessions();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(auth.tokens.token()).toBeNull());
    expect(await screen.findByText("This device only")).toBeInTheDocument();
  });

  it("every signed-in call carries the token as a Bearer header and nothing else carries it", async () => {
    await signedIn();
    await openAccount();
    await screen.findByRole("list", { name: "Devices" });
    const signedInCalls = engine.calls.filter((c) => c.path === "/v1/devices");
    expect(signedInCalls.length).toBeGreaterThan(0);
    expect(signedInCalls.every((c) => /^Bearer token-/.test(c.authorization ?? ""))).toBe(true);
    expect(engine.calls.filter((c) => c.path.startsWith("/v1/accounts") || c.path.includes("/login/")).every((c) => c.authorization === null)).toBe(true);
    expect(localStorage.getItem("token")).toBeNull();
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/token-/);
  });
});
