// @vitest-environment node
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { FAKE_AUTH_MARKER } from "./testing/FakeAuthCrypto";

// The fake crypto and the mock engine are for tests. Two checks keep them out of the app.

const sources = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });

describe("no fake in the app", () => {
  it("only tests and the testing folder import from testing/", () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.includes("/testing/"))
      .filter(([, code]) => /from\s+["'][^"']*\/testing\//.test(code) || /import\(\s*["'][^"']*\/testing\//.test(code))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    // The scan sees the files it should: it finds the test-only ones too.
    expect(Object.keys(sources).some((p) => p.endsWith("/testing/FakeAuthCrypto.ts"))).toBe(true);
  });

  it("the production build contains neither the fake nor the mock engine", async () => {
    const root = new URL("../..", import.meta.url).pathname;
    const result = await build({ root, logLevel: "silent", build: { write: false } });
    const outputs = Array.isArray(result) ? result : "output" in result ? [result] : [];
    const code = outputs
      .flatMap((r) => r.output)
      .map((o) => ("code" in o ? o.code : ""))
      .join("\n");
    expect(code.length).toBeGreaterThan(10_000); // it really built the app
    expect(code).not.toContain(FAKE_AUTH_MARKER);
    for (const name of ["FakeAuthCrypto", "fakeVerify", "fake-registration-request", "createMockEngine", "MockEngine"]) {
      expect(code, name).not.toContain(name);
    }
    // And the app does know it cannot sign in without the real module.
    expect(code).toContain("Sign-in isn't available in this build yet");
  }, 120_000);
});
