import { sessionToken } from "../../api/session";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import { ClockProvider } from "../../app/clock";
import { SIGN_IN_UNAVAILABLE, authCryptoAvailable, registerAuthCrypto } from "../../api/authCrypto";
import { cryptoLoad, ensureRealAuthCrypto, loadRealAuthCrypto, resetCryptoLoad, setCryptoLoader } from "../../api/realCrypto";
import { createMemoryKeyStore, type KeyStore } from "../../api/keyStore";
import { FakeAuthCrypto } from "../../api/testing/FakeAuthCrypto";
import { PROTECTION_GENESIS } from "../../api/testing/protectionFake";
import { createMockEngine, MOCK_TOTP_CODE, type MockEngine } from "../../api/testing/MockEngine";
import { confirmProtection, confirmTotp, enrolTotp, readProtection, signIn, signOut } from "../../auth/flows";
import { signedUp } from "../../auth/testing/signedUp";
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
const wrapFor = (given: KeyStore) => {
  const keys = (given as { root?: KeyStore }).root ?? given; // the account services wrap the store they are given
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

async function mount(auth: AuthServices, path = "/today", strict = false) {
  window.history.replaceState(null, "", path);
  const store = new LocalStore({ persistence: new MemoryPersistence(), now: () => NOW, broadcast: false });
  await store.ready;
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  const app = (
    <ClockProvider value={() => NOW}>
      <App store={store} auth={auth} />
    </ClockProvider>
  );
  const view = render(strict ? <StrictMode>{app}</StrictMode> : app, { container: root });
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
  // The code step comes when the engine has sent a code; a refusal before that shows its message instead.
  await waitFor(() => expect(screen.queryByLabelText("Code") ?? screen.queryByRole("alert")).not.toBeNull());
  if (screen.queryByLabelText("Code") && engine.latestEmailCode(user.email)) await verifyEmail(user.email);
}

/** The code step: the code the mock engine "emailed", typed in. */
async function verifyEmail(address: string, code?: string) {
  const field = await screen.findByLabelText("Code");
  await userEvent.type(field, code ?? engine.latestEmailCode(address)!);
  await userEvent.click(screen.getByRole("button", { name: "Verify" }));
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

  it("an email that is taken gets the same code step, and nothing tells it apart", async () => {
    const first = await mount(services());
    await fillSignUp();
    await todayShown();
    first.unmount();
    await mount(services());
    await fillSignUp();
    // Sign-up never says whether an address has an account: this one gets the same code step, and no code ever comes.
    expect(screen.getByRole("form", { name: "Check your email" })).toBeInTheDocument();
    expect(engine.latestEmailCode(SAM.email)).toBeUndefined();
    await userEvent.type(screen.getByLabelText("Code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn’t right. Use the code in the newest email.");
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
    expect(within(dialog).getByRole("alert")).toHaveTextContent("If this keeps happening, check that this device’s clock is right.");
    expect(within(dialog).getByRole("button", { name: "Start again" })).toBeInTheDocument();
    expect(await onDevice.findByRole("alert")).toHaveTextContent("ran out of time");
    expect(onDevice.getByRole("alert")).toHaveTextContent("check that this device’s clock is right");
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
    await verifyEmail(SAM.email);
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

describe("keys the browser will not store", () => {
  it("the tab holds the account in memory only, and a device approved from it gets the keys", async () => {
    const keysA = createMemoryKeyStore();
    keysA.replaceDevice = () => Promise.reject(new Error("quota"));
    const keysB = createMemoryKeyStore();
    const a = services(keysA);
    const b = services(keysB);

    const first = await mount(a);
    await fillSignUp();
    const card = await screen.findByRole("alert", { name: "Account created, keys not saved" });
    expect(card).toHaveTextContent("Your keys exist only in this tab right now. Keep it open until they’re saved.");
    expect(card).toHaveTextContent("Approving a device you already use gives it the keys while this tab is still open. It uses the same matching digits as Add a device.");
    expect(a.keys.inMemory).toBe(true);
    expect(await keysA.loadKeys()).toBeNull(); // nothing reached storage
    expect(await keysA.loadSession()).toBeNull();
    expect(a.tokens.getSession()?.deviceState).toBe("trusted");
    first.unmount();

    // Another device signs in and waits for approval.
    const second = await mount(b);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn();
    await screen.findByRole("heading", { name: "Approve this device" });
    second.unmount();

    // The tab approves it, with the same digits as Add a device.
    const onA = await mount(a);
    await userEvent.click(await screen.findByRole("button", { name: "Approve another device from this tab" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve another device" });
    expect(dialog).toHaveTextContent("Open Orbyn on your other device.");
    expect(dialog).toHaveTextContent("Check the 6 digits match.");
    expect(dialog).toHaveTextContent("Compare the key fingerprint.");
    const onB = await mount(b);
    const sasA = (await within(dialog).findByTestId("approval-code")).textContent;
    expect(within(dialog).getByTestId("fingerprint").textContent).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
    expect((await within(onB.root).findByTestId("approval-code")).textContent).toBe(sasA);
    await userEvent.click(within(dialog).getByRole("button", { name: "They match" }));
    expect(await within(dialog).findByText("You said the digits and fingerprint match.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "They match" })).toBeNull(); // replaced by the waiting line
    await userEvent.click(within(onB.root).getByRole("button", { name: "They match" }));
    await userEvent.click(await within(onB.root).findByRole("button", { name: "Continue" }));
    expect(b.tokens.getSession()?.deviceState).toBe("trusted");
    expect(await keysB.loadKeys()).not.toBeNull(); // the device that can keep them has them
    expect(await keysA.loadKeys()).toBeNull(); // and this tab still wrote nothing
    // Back on the tab: it says where the keys are now, and Continue opens the planner with them held in memory only.
    const done = await screen.findByRole("status", { name: "Keys approved" });
    expect(done).toHaveTextContent(`Your keys are on ${deviceName()} now.`);
    expect(done).toHaveTextContent("This browser still can’t keep them, so you’ll sign in again here next time.");
    expect(within(done).getByRole("button", { name: "Sign out of this browser" })).toBeInTheDocument();
    await userEvent.click(within(done).getByRole("button", { name: "Continue" }));
    expect(await within(onA.root).findByRole("heading", { name: "Nothing planned yet" })).toBeInTheDocument();
    expect(a.keys.inMemory).toBe(true);
    onB.unmount();
    onA.unmount();
  });

  it("the approve dialog warns before They match, says what was confirmed after it, and tells the person when the other device never answers", async () => {
    const keysA = createMemoryKeyStore();
    keysA.replaceDevice = () => Promise.reject(new Error("quota"));
    const a = services(keysA);
    const b = services(createMemoryKeyStore());
    const first = await mount(a);
    await fillSignUp();
    await screen.findByRole("alert", { name: "Account created, keys not saved" });
    first.unmount();
    const second = await mount(b);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn();
    await screen.findByRole("heading", { name: "Approve this device" });
    second.unmount();

    await mount(a);
    await userEvent.click(await screen.findByRole("button", { name: "Approve another device from this tab" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve another device" });
    await mount(b); // the other device shows its digits, then never confirms
    await within(dialog).findByTestId("approval-code");
    expect(dialog).toHaveTextContent("Only continue if both match exactly. If they don’t, press Cancel: someone else may be trying to add a device.");
    nowMs += 11 * 60_000; // the approval runs out
    await userEvent.click(within(dialog).getByRole("button", { name: "They match" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Your other device didn’t answer in 10 minutes. Nothing was shared.");
    expect(within(dialog).queryByRole("button", { name: "They match" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Start again" })); // a new approval
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it.each([
    ["Cancel", async (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))],
    ["Escape", async (dialog: HTMLElement) => { dialog.focus(); await userEvent.keyboard("{Escape}"); }],
    ["a click outside", async (dialog: HTMLElement) => userEvent.pointer({ keys: "[MouseLeft]", target: dialog.parentElement! })],
  ])("closing the approve dialog with %s closes the approval on the server", async (_how, close) => {
    const keysA = createMemoryKeyStore();
    keysA.replaceDevice = () => Promise.reject(new Error("quota"));
    const a = services(keysA);
    const b = services(createMemoryKeyStore());
    const first = await mount(a);
    await fillSignUp();
    await screen.findByRole("alert", { name: "Account created, keys not saved" });
    first.unmount();
    const second = await mount(b);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn();
    await screen.findByRole("heading", { name: "Approve this device" });
    second.unmount();
    await mount(a);
    await userEvent.click(await screen.findByRole("button", { name: "Approve another device from this tab" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve another device" });
    await waitFor(() => expect(engine.calls.some((c) => c.method === "POST" && c.path === "/v1/devices/approvals")).toBe(true));
    await close(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Approve another device" })).toBeNull());
    await waitFor(() => expect(engine.calls.some((c) => c.method === "POST" && c.path.endsWith("/cancel"))).toBe(true));
  });

  it("with two devices waiting the person chooses which to approve: nothing is picked, and the device's name, kind and time show", async () => {
    const keysA = createMemoryKeyStore();
    keysA.replaceDevice = () => Promise.reject(new Error("quota"));
    const a = services(keysA);
    const first = await mount(a);
    await fillSignUp();
    await screen.findByRole("alert", { name: "Account created, keys not saved" });
    first.unmount();
    for (const keys of [createMemoryKeyStore(), createMemoryKeyStore()]) {
      const view = await mount(services(keys));
      await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
      await fillSignIn();
      await screen.findByRole("heading", { name: "Approve this device" });
      view.unmount();
    }
    await mount(a);
    await userEvent.click(await screen.findByRole("button", { name: "Approve another device from this tab" }));
    const dialog = await screen.findByRole("dialog");
    const group = await within(dialog).findByRole("radiogroup", { name: "Devices" });
    await waitFor(() => expect(within(group).getAllByRole("radio")).toHaveLength(2));
    expect(dialog).toHaveTextContent("More than one device is waiting. Choose the one you’re holding.");
    expect(within(group).getAllByRole("radio").filter((r) => (r as HTMLInputElement).checked)).toHaveLength(1); // the newest is selected until the person picks
    expect(engine.calls.some((c) => c.method === "POST" && c.path === "/v1/devices/approvals")).toBe(false); // none was started yet
    await userEvent.click(within(group).getAllByRole("radio")[0]!);
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await within(dialog).findByText("Waiting for your other device…"); // the chosen one's approval started; its details are the chooser's, not this dialog's
    expect(within(dialog).queryByText("Kind")).toBeNull();
  });

  /** A holds its account in memory (storage refuses), and B has signed in and waits. A is mounted, its dialog open. */
  async function dialogOpen(strict = false) {
    const keysA = createMemoryKeyStore();
    keysA.replaceDevice = () => Promise.reject(new Error("quota"));
    const a = services(keysA);
    const b = services(createMemoryKeyStore());
    const first = await mount(a);
    await fillSignUp();
    await screen.findByRole("alert", { name: "Account created, keys not saved" });
    first.unmount();
    const second = await mount(b);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn();
    await screen.findByRole("heading", { name: "Approve this device" });
    second.unmount();
    const onA = await mount(a, "/today", strict);
    await userEvent.click(await screen.findByRole("button", { name: "Approve another device from this tab" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve another device" });
    return { a, b, keysA, onA, dialog };
  }
  const approvalsStarted = () => engine.calls.filter((c) => c.method === "POST" && c.path === "/v1/devices/approvals").length;
  const approvalsCancelled = () => engine.calls.filter((c) => c.method === "POST" && c.path.endsWith("/cancel")).length;

  it("when the other device cancels, the dialog says so and Start again is the main button", async () => {
    const { b, dialog } = await dialogOpen();
    const onB = await mount(b);
    await within(dialog).findByTestId("approval-code");
    await within(onB.root).findByTestId("approval-code");
    await userEvent.click(within(onB.root).getByRole("button", { name: "Cancel" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Your other device cancelled. Nothing was shared.");
    expect(within(dialog).getByRole("button", { name: "Start again" })).toHaveClass("btn");
  });

  it("pressing Cancel at the comparison says the digits didn't match, and Start again begins a new approval", async () => {
    const { b, dialog } = await dialogOpen();
    await mount(b);
    await within(dialog).findByTestId("approval-code");
    const before = approvalsStarted();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The digits didn’t match, so nothing was shared. If you didn’t start this, someone else may be trying to add a device.");
    await waitFor(() => expect(approvalsCancelled()).toBeGreaterThan(0));
    await userEvent.click(within(dialog).getByRole("button", { name: "Start again" }));
    await waitFor(() => expect(approvalsStarted()).toBe(before + 1));
  });

  it("in React's development check the approval is started once and is not cancelled", async () => {
    const { b, dialog } = await dialogOpen(true);
    await mount(b);
    await within(dialog).findByTestId("approval-code");
    expect(approvalsStarted()).toBe(1);
    expect(approvalsCancelled()).toBe(0);
  });

  it("after Continue, nothing about the account reaches IndexedDB, localStorage or sessionStorage", async () => {
    // IndexedDB exists here, so a planner opened for the account would try its own database; every attempt is counted.
    const opened: string[] = [];
    vi.stubGlobal("indexedDB", {
      open: (name: string) => {
        opened.push(name);
        const request: { onerror?: () => void; error: Error } = { error: new Error("not in this test") };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    });
    const writes: string[] = [];
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string) {
      writes.push(key);
    });
    try {
      const keysA = createMemoryKeyStore();
      keysA.replaceDevice = () => Promise.reject(new Error("quota"));
      const a = services(keysA);
      const b = services(createMemoryKeyStore());
      /** The real app, with no store handed in, so the planner for the account is chosen as in a build. */
      const mountReal = async (auth: AuthServices) => {
        window.history.replaceState(null, "", "/today");
        const root = document.createElement("div");
        document.body.appendChild(root);
        const view = render(<ClockProvider value={() => NOW}><App auth={auth} /></ClockProvider>, { container: root });
        return { root, unmount: () => { view.unmount(); root.remove(); } };
      };
      const first = await mountReal(a);
      await fillSignUp();
      await screen.findByRole("alert", { name: "Account created, keys not saved" });
      const accountId = a.tokens.getSession()!.accountId;
      first.unmount();
      const second = await mount(b);
      await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
      await fillSignIn();
      await screen.findByRole("heading", { name: "Approve this device" });
      second.unmount();

      const onA = await mountReal(a);
      await userEvent.click(await screen.findByRole("button", { name: "Approve another device from this tab" }));
      const dialog = await screen.findByRole("dialog", { name: "Approve another device" });
      const onB = await mount(b);
      await within(dialog).findByTestId("approval-code");
      await userEvent.click(within(dialog).getByRole("button", { name: "They match" }));
      await userEvent.click(await within(onB.root).findByRole("button", { name: "They match" }));
      await userEvent.click(await within(onB.root).findByRole("button", { name: "Continue" }));
      // The other device is a browser of its own, which stores what it likes; what this one writes from here on is counted.
      onB.unmount();
      writes.length = 0;
      await userEvent.click(await within(onA.root).findByRole("button", { name: "Continue" }));
      await within(onA.root).findByRole("navigation", { name: "Primary" });

      // Use the planner: the notifications, then Settings · Privacy, which reads the protection chain.
      await userEvent.click(within(onA.root).getByRole("link", { name: /Notifications/ }));
      await within(onA.root).findByText("You’re all caught up");
      await userEvent.click(within(onA.root).getByRole("link", { name: /Settings/ }));
      await userEvent.click(await within(onA.root).findByRole("button", { name: "Privacy" }));
      await within(onA.root).findByLabelText("Protection");
      await within(onA.root).findByText(/Standard protection|Confirming|Choose your protection level/);

      expect(opened.filter((name) => name.includes(accountId))).toEqual([]); // no database for the account
      expect(writes.filter((key) => key.includes(accountId) || /protection|notifications-read/.test(key))).toEqual([]);
      expect(await keysA.loadKeys()).toBeNull();
      onA.unmount();
    } finally {
      setItem.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("Try saving again moves the account into storage once it works, and the planner opens", async () => {
    const keysA = createMemoryKeyStore();
    const replace = keysA.replaceDevice.bind(keysA);
    keysA.replaceDevice = () => Promise.reject(new Error("quota"));
    const a = services(keysA);
    await mount(a);
    await fillSignUp();
    await screen.findByRole("alert", { name: "Account created, keys not saved" });
    await userEvent.click(screen.getByRole("button", { name: "Try saving again" }));
    expect(screen.getByRole("alert", { name: "Account created, keys not saved" })).toBeInTheDocument(); // still refused: stays in memory
    expect(a.keys.inMemory).toBe(true);
    // The second refusal says so, and approving another device becomes the main button.
    expect(await screen.findByText("Still couldn’t save. This browser may not allow it. Approve another device from this tab instead.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve another device from this tab" })).toHaveClass("btn");
    keysA.replaceDevice = replace;
    await userEvent.click(screen.getByRole("button", { name: "Try saving again" }));
    await todayShown();
    expect(a.keys.inMemory).toBe(false);
    expect(await keysA.loadKeys()).not.toBeNull();
    expect((await keysA.loadSession())?.deviceState).toBe("trusted");
  });

  it("signing out lets the held keys go", async () => {
    const keysA = createMemoryKeyStore();
    keysA.replaceDevice = () => Promise.reject(new Error("quota"));
    const a = services(keysA);
    await mount(a);
    await fillSignUp();
    await screen.findByRole("alert", { name: "Account created, keys not saved" });
    await signOut(a);
    expect(a.keys.inMemory).toBe(false);
    expect(await a.keys.loadKeys()).toBeNull();
    expect(await a.keys.loadIdentity()).toBeNull();
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

  it("signing out removes what the protection notice kept about the account and another device", async () => {
    const auth = await signedIn();
    const accountId = auth.tokens.getSession()!.accountId;
    localStorage.setItem(`orbyn-planner.protection-changed.${accountId}`, "2");
    localStorage.setItem(`orbyn-planner.protection-changed-by.${accountId}`, JSON.stringify({ seq: 2, name: "Sam’s iPhone" }));
    await openAccount();
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Sign out" })).getByRole("button", { name: "Keep on this browser" }));
    await screen.findByRole("heading", { name: /Your tasks and calendar/ });
    expect(Object.keys(localStorage).filter((k) => k.includes(accountId))).toEqual([]);
  });

  it("Sign out ends the session on the server and here, and shows the landing page", async () => {
    const auth = await signedIn();
    await openAccount();
    await waitFor(async () => expect(await auth.keys.loadSnapshot()).not.toBeNull()); // opening Account made the engine's state
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    const ask = screen.getByRole("dialog", { name: "Sign out" });
    expect(ask).toHaveTextContent("Remove this account’s planner from this browser?");
    expect(ask).toHaveTextContent("It stays on this browser unencrypted.");
    await waitFor(() => expect(within(ask).getByRole("button", { name: "Cancel" })).toHaveFocus()); // the safe choice is the default: Enter must not remove the planner (focus moves in just after the dialog appears)
    expect(within(ask).getByRole("button", { name: "Remove" })).not.toHaveFocus();
    await userEvent.click(within(ask).getByRole("button", { name: "Keep on this browser" }));
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
    await userEvent.click(within(screen.getByRole("dialog", { name: "Sign out" })).getByRole("button", { name: "Remove" }));
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
    await verifyEmail(SAM.email);
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

describe("email verification at sign-up", () => {
  async function toCodeStep(keys = createMemoryKeyStore(), strict = false) {
    const auth = services(keys);
    await mount(auth, "/today", strict);
    await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
    await userEvent.type(screen.getByLabelText("Name"), SAM.name);
    await userEvent.type(screen.getByLabelText("Email"), SAM.email);
    await userEvent.type(screen.getByLabelText("Password"), SAM.password);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByRole("form", { name: "Check your email" });
    return { auth, keys };
  }

  it("asks for the code, keeps nothing until it is right, says when it didn’t work, and only then signs in and stores the keys", async () => {
    const { auth, keys } = await toCodeStep();
    const form = screen.getByRole("form", { name: "Check your email" });
    expect(within(form).getByText(/sam@example\.com/)).toBeInTheDocument();
    expect(within(form).getByText(/It works for 30 minutes\./)).toBeInTheDocument();
    // No account and no session: nothing is stored.
    expect(auth.tokens.getSession()).toBeNull();
    expect(await keys.loadKeys()).toBeNull();
    expect(await keys.loadIdentity()).toBeNull();

    await userEvent.type(screen.getByLabelText("Code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn’t right. Use the code in the newest email.");
    expect(screen.getByLabelText("Code").closest("form")!.querySelectorAll(".cbox.err")).toHaveLength(6); // red boxes
    expect(await keys.loadKeys()).toBeNull();
    expect(screen.getByText(/Send a new code in \d:\d\d/)).toBeInTheDocument(); // the countdown; a new code is always on its way

    await userEvent.clear(screen.getByLabelText("Code"));
    await userEvent.type(screen.getByLabelText("Code"), engine.latestEmailCode(SAM.email)!);
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    await todayShown();
    expect(auth.tokens.getSession()?.deviceState).toBe("trusted");
    expect(await keys.loadKeys()).not.toBeNull();
  });

  it("in React's development check, which mounts the screen twice, the right code still signs up", async () => {
    const { auth, keys } = await toCodeStep(createMemoryKeyStore(), true);
    await userEvent.type(screen.getByLabelText("Code"), engine.latestEmailCode(SAM.email)!);
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    await todayShown();
    expect(auth.tokens.getSession()?.deviceState).toBe("trusted");
    expect(await keys.loadKeys()).not.toBeNull();
  });

  it("a new code can be asked for a minute after the last one, three times an hour, and the old code stops working", async () => {
    await toCodeStep();
    expect(screen.getByText(/Send a new code in 1:00/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send a new code" })).toBeNull();
    const first = engine.latestEmailCode(SAM.email)!;
    for (let i = 1; i <= 3; i++) {
      nowMs += 61_000;
      const resend = await screen.findByRole("button", { name: "Send a new code" }, { timeout: 3000 });
      await userEvent.click(resend);
      await waitFor(() => expect(engine.latestEmailCode(SAM.email)).not.toBe(first));
      if (i < 3) await screen.findByText(/Send a new code in/);
    }
    // After the third the limit shows, in amber, with no wait: the code boxes stay usable.
    expect(await screen.findByText("You’ve asked for several codes. Try again later, or check your spam folder.")).toBeInTheDocument();
    expect(screen.getByText("Send a new code · not available right now")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send a new code" })).toBeNull();
    await userEvent.type(screen.getByLabelText("Code"), first);
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn’t right. Use the code in the newest email.");
  });

  it("when the engine refuses a resend as too many attempts, the same limit shows", async () => {
    await toCodeStep();
    engine.refuseNext("/v1/accounts/email/resend", 429, "too_many_attempts");
    nowMs += 61_000;
    await userEvent.click(await screen.findByRole("button", { name: "Send a new code" }, { timeout: 3000 }));
    expect(await screen.findByText("You’ve asked for several codes. Try again later, or check your spam folder.")).toBeInTheDocument();
    expect(screen.getByLabelText("Code")).toBeEnabled();
  });

  it("six boxes take a paste with spaces, and Verify waits for six digits", async () => {
    await toCodeStep();
    const verifyButton = screen.getByRole("button", { name: "Verify" });
    expect(verifyButton).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Code"));
    await userEvent.paste("482 91");
    expect(verifyButton).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Code"));
    await userEvent.paste(`${engine.latestEmailCode(SAM.email)!.slice(0, 3)} ${engine.latestEmailCode(SAM.email)!.slice(3)}`);
    expect(verifyButton).toBeEnabled();
    expect(screen.getByLabelText("Code").closest("form")!.querySelectorAll(".cbox")).toHaveLength(6);
  });

  it("the password is not kept in the page once the code is awaited", async () => {
    await toCodeStep();
    expect((document.getElementById("su-password") as HTMLInputElement).value).toBe(""); // the form is still mounted, hidden
    expect(document.body.innerHTML).not.toContain(SAM.password);
  });

  it("a browser that can't even hold the keys in memory says so before anything is created", async () => {
    const keys = createMemoryKeyStore();
    const a = createAuthServices({ fetch: engine.fetch, baseUrl: "http://engine.test", keys, crypto: () => crypto, now: () => nowMs, poll: FAST_POLL, wrapSecret: () => Promise.reject(new Error("no crypto")) });
    await mount(a);
    await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
    await userEvent.type(screen.getByLabelText("Name"), SAM.name);
    await userEvent.type(screen.getByLabelText("Email"), SAM.email);
    await userEvent.type(screen.getByLabelText("Password"), SAM.password);
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    const card = await screen.findByRole("alert", { name: "This browser can’t create an Orbyn account" });
    expect(card).toHaveTextContent("Orbyn has to keep your encryption keys, and this browser won’t store them or hold them in memory. Nothing was created.");
    expect(within(card).getByRole("button", { name: "Copy this page’s address" })).toBeInTheDocument();
    // The app link goes to the site's download page, not a store or an installer.
    expect(within(card).getByRole("link", { name: "See the Orbyn apps" })).toHaveAttribute("href", "https://orbyn.dev/download");
    expect(card).toHaveTextContent("The apps aren’t out yet. This page lists what’s being built.");
    expect(within(card).queryByRole("button", { name: /again|retry/i })).toBeNull(); // retrying can't help
    expect(engine.calls.filter((c) => c.path.startsWith("/v1/accounts"))).toHaveLength(0); // nothing reached the engine
  });

  it("Change email starts over, and the abandoned sign-up leaves nothing behind", async () => {
    const { keys } = await toCodeStep();
    await userEvent.click(screen.getByRole("button", { name: "Change email" }));
    expect(screen.getByRole("form", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue(SAM.email); // kept, to correct
    expect(screen.getByLabelText("Password")).toHaveValue(""); // the password was not kept in the page while the code was awaited
    expect(await keys.loadKeys()).toBeNull();
    expect(await keys.loadSnapshot()).toBeNull();
  });
});

describe("two-factor", () => {
  async function signedIn() {
    const auth = services();
    await mount(auth, "/settings");
    await fillSignUp();
    await screen.findByRole("navigation", { name: "Primary" });
    await openAccount();
    return auth;
  }

  it("Settings turns it on with a QR code made here, the secret as text and a code, shows ten recovery codes once to copy or download, and turns it off with no code", async () => {
    await signedIn();
    const row = await screen.findByText("Two-factor");
    await waitFor(() => expect(within(row.parentElement!).getByText("Off")).toBeInTheDocument());
    await userEvent.click(within(row.parentElement!).getByRole("button", { name: "Turn on…" }));
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("img", { name: "QR code for your authenticator app" })).toBeInTheDocument();
    expect(screen.getByLabelText("Secret key")).toHaveTextContent(/JBSW Y3DP EHPK 3PXP/);
    expect(engine.calls.filter((c) => c.path === "/v1/accounts/totp")).toHaveLength(1); // the QR came from that one answer: nothing else was asked

    await userEvent.type(screen.getByLabelText("Code from the app"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn’t work.");
    await userEvent.clear(screen.getByLabelText("Code from the app"));
    await userEvent.type(screen.getByLabelText("Code from the app"), MOCK_TOTP_CODE);
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));

    const list = await screen.findByRole("list", { name: "Recovery codes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => void written.push(t) } });
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(written[0]).toContain("RECOV-00001");
    // One line says what happened, what to do next and why; the clipboard is not touched again.
    expect(await screen.findByText("Copied. Paste them somewhere safe, then copy something else so they don’t stay on your clipboard.")).toBeInTheDocument();
    expect(written).toHaveLength(1);
    URL.createObjectURL = vi.fn(() => "blob:codes");
    URL.revokeObjectURL = vi.fn();
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    await userEvent.click(screen.getByRole("button", { name: "Download .txt" }));
    expect(saved).toEqual(["orbyn-recovery-codes.txt"]);
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled(); // not until the person says they saved them
    await userEvent.click(screen.getByRole("checkbox", { name: "I’ve saved these codes" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(within(row.parentElement!).getByText("On")).toBeInTheDocument());
    await userEvent.click(within(row.parentElement!).getByRole("button", { name: "Turn off…" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Turn off two-factor" })).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(within(row.parentElement!).getByText("Off")).toBeInTheDocument());
  });

  it("signing in on a new browser asks for a code, says when it didn’t work, and takes a recovery code instead", async () => {
    // The account has two-factor on, set up from its first browser.
    const first = services();
    const session = await signedUp(engine, first, { name: SAM.name, email: SAM.email, password: SAM.password });
    await enrolTotp(first, session);
    const { recovery_codes } = await confirmTotp(first, session, MOCK_TOTP_CODE);

    const second = services();
    await mount(second);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await fillSignIn();
    expect(await screen.findByRole("form", { name: "Two-factor code" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn’t work.");
    await userEvent.click(screen.getByRole("button", { name: "Use a recovery code" }));
    await userEvent.type(screen.getByLabelText("Recovery code"), recovery_codes[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(second.tokens.getSession()).not.toBeNull());
    expect(screen.queryByRole("form", { name: "Two-factor code" })).not.toBeInTheDocument();
  });
});

describe("the protection level", () => {
  async function privacy() {
    const auth = services();
    await mount(auth, "/settings");
    await fillSignUp();
    await screen.findByRole("navigation", { name: "Primary" });
    await userEvent.click(await screen.findByRole("button", { name: "Privacy" }));
    return auth;
  }

  it("shows Standard, verified from the chain, and says plainly that Orbyn can read Standard data", async () => {
    await privacy();
    const card = await screen.findByLabelText("Protection");
    expect(await within(card).findByText("Standard protection")).toBeInTheDocument();
    expect(card).toHaveTextContent("Verified");
    expect(card).toHaveTextContent("Confirmed by your devices. Last change 7 Nov on");
    expect(card).toHaveTextContent("Advanced protectionOnly your devices hold the keys.Planned"); // shown, and not available yet
    expect(engine.accounts.get("sam@example.com")!.protection).toHaveLength(1); // signed once, at sign-up
  });

  it("says Not set when the first signing failed; Choose opens the confirm dialog and Confirm signs Standard", async () => {
    engine.refuseNext("/v1/keychain/protection", 500, "internal", "Refused.", 1);
    await privacy();
    const card = await screen.findByLabelText("Protection");
    expect(await within(card).findByText("Choose your protection level")).toBeInTheDocument();
    expect(card).toHaveTextContent("Not set");
    expect(card).toHaveTextContent("No device has set a protection level for this account yet. Until one does, your data uses Standard protection.");
    expect(engine.accounts.get("sam@example.com")!.protection ?? []).toHaveLength(0); // nothing signed it on its own
    expect(screen.queryByRole("dialog")).toBeNull(); // it opens when the person chooses

    await userEvent.click(within(card).getByRole("button", { name: "Choose" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm your protection level" });
    expect(dialog).toHaveTextContent("Confirming sets Standard protection.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Set Standard protection" }));
    await waitFor(() => expect(engine.accounts.get("sam@example.com")!.protection).toHaveLength(1));
    expect(await within(await screen.findByLabelText("Protection")).findByText("Standard protection")).toBeInTheDocument();
  });

  it("after a rollback or a fork the level is not shown as verified: the card warns and says why", async () => {
    const auth = await privacy();
    const session = auth.tokens.getSession()!;
    await screen.findByText("Standard protection");
    const account = engine.accounts.get("sam@example.com")!;
    await confirmProtection(auth, session, "standard", (await readProtection(auth, session)).head); // this device verified sequence 2
    const good = [...account.protection!];
    const reopen = async () => {
      await userEvent.click(await screen.findByRole("button", { name: "Account" }));
      await userEvent.click(await screen.findByRole("button", { name: "Privacy" }));
    };

    // The server now shows only sequence 1: older than what this device verified.
    account.protection = good.slice(0, 1);
    account.protectionFromStart = true;
    await reopen();
    const card = await screen.findByLabelText("Protection");
    expect(await within(card).findByText(/Standard protection, last confirmed/)).toBeInTheDocument();
    expect(card).toHaveTextContent("Can’t confirm");
    expect(card).toHaveTextContent("The server showed an older setting than this browser has already confirmed. This browser keeps the setting it last confirmed until a trusted device confirms it again.");
    expect(card).toHaveTextContent("Open Orbyn on a trusted device to fix this.");
    expect(within(card).queryByText("Verified")).toBeNull();
    expect(within(card).queryByRole("button", { name: "Confirm protection level" })).toBeNull(); // there is no head to sign after

    // Or a different setting at sequence 2.
    account.protection = [good[0]!, { ...good[1]!, level: "advanced" }];
    account.protectionFromStart = false;
    await reopen();
    expect(await within(await screen.findByLabelText("Protection")).findByText(/The server showed two different settings\./)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Protection")).queryByText("Verified")).toBeNull();
    expect(within(screen.getByLabelText("Protection")).queryByRole("button", { name: "Confirm protection level" })).toBeNull();
    expect(screen.queryByText(/Protection was changed to/)).toBeNull(); // a fork names no device
  });

  it("a conflict in Confirm reads the chain again: a setting this browser can't verify shows Can't confirm and is never signed again", async () => {
    engine.refuseNext("/v1/keychain/protection", 500, "internal", "Refused.", 1);
    await privacy();
    const card = await screen.findByLabelText("Protection");
    await userEvent.click(await within(card).findByRole("button", { name: "Choose" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm your protection level" });
    // Another device signs sequence 1 first, with a signature this browser cannot check.
    const account = engine.accounts.get("sam@example.com")!;
    const other = account.devices[0]!;
    account.protection = [{ level: "standard", seq: 1, prev: PROTECTION_GENESIS, signed_at: Math.floor(nowMs / 1000) as unknown as bigint, signer_device_id: other.id, signature: "not-checked-here" }];
    await userEvent.click(within(dialog).getByRole("button", { name: "Set Standard protection" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await within(await screen.findByLabelText("Protection")).findByText("Can’t confirm")).toBeInTheDocument();
    expect(account.protection).toHaveLength(1); // nothing was signed after the stale head
  });

  it("says when another device changed the level since this device last saw it, until dismissed", async () => {
    const first = await privacy();
    const session = first.tokens.getSession()!;
    await screen.findByText("Standard protection");
    // Another trusted device signs the next setting.
    const second = services();
    const sessionB = await signIn(second, SAM);
    const account = engine.accounts.get("sam@example.com")!;
    const phone = account.devices.find((d) => d.id === sessionB.deviceId)!;
    phone.state = "trusted";
    phone.approved_by = session.deviceId;
    phone.approval_signature = "approved";
    await second.tokens.set({ ...sessionB, deviceState: "trusted" });
    const trusted = { ...sessionB, deviceState: "trusted" as const };
    await readProtection(second, trusted);
    await confirmProtection(second, trusted, "standard", account.protection![0]!);
    expect(account.protection).toHaveLength(2);
    // The first device reads it again when Settings opens.
    await userEvent.click(await screen.findByRole("button", { name: "Account" }));
    await userEvent.click(await screen.findByRole("button", { name: "Privacy" }));
    const note = await screen.findByText(/Protection was changed to Standard on/);
    expect(note).toHaveTextContent(phone.name);
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Protection was changed to/)).toBeNull();
  });
});

describe("the engine's module fails to load", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setCryptoLoader(loadRealAuthCrypto);
    resetCryptoLoad();
    localStorage.removeItem("orbyn-planner.local-only");
  });

  it("says so, with Retry, instead of saying the build has no sign-in; Retry loads it", async () => {
    vi.stubEnv("VITE_ENGINE_URL", "http://engine.test");
    let attempts = 0;
    setCryptoLoader(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("blocked");
      return crypto;
    });
    await ensureRealAuthCrypto();
    expect(cryptoLoad.get()).toBe("failed");
    localStorage.setItem("orbyn-planner.local-only", "1");
    await mount(services(), "/settings");
    await openAccount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load Orbyn’s security module");
    expect(screen.queryByText(/isn't available in this build yet/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(cryptoLoad.get()).toBe("ready"));
    expect(attempts).toBe(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(authCryptoAvailable()).toBe(true);
  });

  it("a build with no engine address has no module to load, and says that plainly", async () => {
    await ensureRealAuthCrypto();
    expect(cryptoLoad.get()).toBe("idle");
    localStorage.setItem("orbyn-planner.local-only", "1");
    await mount(services(), "/settings");
    await openAccount();
    expect(screen.queryByText("Couldn’t load Orbyn’s security module")).not.toBeInTheDocument();
  });
});
