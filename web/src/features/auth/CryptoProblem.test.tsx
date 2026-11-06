import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRealAuthCrypto, resetCryptoLoad, setCryptoLoader, loadRealAuthCrypto } from "../../api/realCrypto";
import { CryptoProblem } from "./CryptoProblem";

afterEach(() => {
  vi.unstubAllEnvs();
  setCryptoLoader(loadRealAuthCrypto);
  resetCryptoLoad();
});

describe("when the module won't load", () => {
  it("offers Retry, and after a Retry fails too, Reload the page", async () => {
    vi.stubEnv("VITE_ENGINE_URL", "http://engine.test");
    let attempts = 0;
    setCryptoLoader(async () => {
      attempts += 1;
      throw new Error("blocked");
    });
    await ensureRealAuthCrypto();
    const reload = vi.fn();
    render(<CryptoProblem onReload={reload} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load Orbyn’s security module");
    expect(screen.queryByRole("button", { name: "Reload the page" })).not.toBeInTheDocument(); // not before a Retry has failed
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reload the page" })).toBeInTheDocument());
    expect(attempts).toBe(2);
    await userEvent.click(screen.getByRole("button", { name: "Reload the page" }));
    expect(reload).toHaveBeenCalled();
  });
});
