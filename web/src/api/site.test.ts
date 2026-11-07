import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadUrl, siteUrl } from "./site";

afterEach(() => vi.unstubAllEnvs());

describe("the Orbyn site address", () => {
  it("defaults to orbyn.dev, and a build setting overrides it", () => {
    expect(downloadUrl()).toBe("https://orbyn.dev/download");
    vi.stubEnv("VITE_ORBYN_SITE_URL", "https://staging.orbyn.dev/");
    expect(siteUrl()).toBe("https://staging.orbyn.dev");
    expect(downloadUrl()).toBe("https://staging.orbyn.dev/download");
  });
});

describe("the launch switch", () => {
  it("is off by default and on only when the build says true", async () => {
    const { appsAvailable } = await import("./site");
    expect(appsAvailable()).toBe(false);
    vi.stubEnv("VITE_ORBYN_APPS_AVAILABLE", "true");
    expect(appsAvailable()).toBe(true);
  });
});
