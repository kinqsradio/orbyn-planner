import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { CancelDeletionPage, forgetTokenForTests } from "./CancelDeletionPage";

const nodeFs = "node:fs";
const fs = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(path: string, encoding: "utf8"): string };

const fetchMock = vi.fn();
const TOKEN = "dG9rZW4tdG9rZW4tdG9rZW4";

beforeEach(() => {
  forgetTokenForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", `/cancel-deletion#${TOKEN}`);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const press = () => userEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));

describe("the cancel link from the deletion email", () => {
  it("opening it only shows the question: the token is taken off the address and nothing is sent", () => {
    render(<StrictMode><CancelDeletionPage /></StrictMode>);
    expect(screen.getByRole("heading", { name: "Cancel account deletion?" })).toBeInTheDocument();
    expect(screen.getByText("Your Orbyn account is scheduled to be deleted. Nothing happens until you press the button. Opening this page doesn’t cancel anything.")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute("content")).toBe("no-referrer");
  });

  it("pressing the button posts the token once, never on a GET, and says it was cancelled", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<CancelDeletionPage />);
    await press();
    expect(await screen.findByRole("heading", { name: "Deletion cancelled" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/v1\/accounts\/delete\/cancel-by-mail$/);
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN });
    expect(init.referrerPolicy).toBe("no-referrer");
    expect(init.credentials).toBe("omit");
  });

  it("a double press posts once, while the first is still out", async () => {
    let finish: (r: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (finish = resolve)));
    render(<CancelDeletionPage />);
    await press();
    expect(await screen.findByText("Cancelling…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel deletion" })).toBeNull();
    finish(new Response(null, { status: 204 }));
    await screen.findByRole("heading", { name: "Deletion cancelled" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("every refused token is one message, which says nothing about the account", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "invalid_cancel_token" }), { status: 400 }));
    render(<CancelDeletionPage />);
    await press();
    expect(await screen.findByRole("heading", { name: "This link doesn’t work any more" })).toBeInTheDocument();
    expect(screen.getByText("It may have been used already, or the deletion may have finished or been cancelled. Sign in to check.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("a link with no token is that same message, and nothing is sent", () => {
    window.history.replaceState(null, "", "/cancel-deletion");
    render(<CancelDeletionPage />);
    expect(screen.getByRole("heading", { name: "This link doesn’t work any more" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("when Orbyn doesn't answer, the deletion stays scheduled and Try again presses again with the same token", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<CancelDeletionPage />);
    await press();
    expect(await screen.findByRole("heading", { name: "Couldn’t cancel deletion" })).toBeInTheDocument();
    expect(screen.getByText("Orbyn didn’t answer, so nothing changed yet. Your deletion is still scheduled.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Deletion cancelled" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string)).toEqual({ token: TOKEN });
  });

  it("touches no storage and imports nothing from the accounts layer, the planner's stores or sync", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const open = vi.fn();
    vi.stubGlobal("indexedDB", { open });
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<CancelDeletionPage />);
    await press();
    await screen.findByRole("heading", { name: "Deletion cancelled" });
    expect(setItem).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    setItem.mockRestore();
    const source = fs.readFileSync(`${(globalThis as { process?: { cwd(): string } }).process!.cwd()}/src/features/auth/CancelDeletionPage.tsx`, "utf8");
    for (const forbidden of ["/auth/", "/store/", "/sync/", "realCrypto", "AuthProvider"]) expect(source, forbidden).not.toContain(`from "../..${forbidden}`);
    expect(source).not.toMatch(/from "\.\.\/\.\.\/(auth|store|sync)\b/);
  });
});
