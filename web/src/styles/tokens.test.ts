import { describe, expect, it } from "vitest";
import { DANGER_FILL, EASING, HOUR_PX, MOTION_MS, PHONE_MAX_PX, SLOW_FACTOR } from "./tokens";

// The stylesheets as text. The web project has no Node types, so the file system comes in by a dynamic import.
const nodeFs = "node:fs";
const fs = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(path: string, encoding: "utf8"): string };
const here = `${(globalThis as { process?: { cwd(): string } }).process!.cwd()}/src/styles`;
const css = fs.readFileSync(`${here}/tokens.css`, "utf8");
const app = fs.readFileSync(`${here}/app.css`, "utf8");
const declared = (name: string): string => {
  const m = new RegExp(`${name.replace(/[-]/g, "\\-")}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`${name} is not in tokens.css`);
  return m[1]!.trim();
};

describe("tokens.ts and tokens.css say the same", () => {
  it("every motion duration is the CSS duration at --k 1", () => {
    const names: Record<keyof typeof MOTION_MS, string> = {
      fast: "--m-fast", base: "--m-base", slow: "--m-slow", page: "--m-page", fastOut: "--m-fast-out", baseOut: "--m-base-out",
      slowOut: "--m-slow-out", pageOut: "--m-page-out", wait: "--m-wait", hover: "--m-hover", stag: "--m-stag",
    };
    for (const [key, name] of Object.entries(names)) {
      expect(declared(name), name).toBe(`calc(${MOTION_MS[key as keyof typeof MOTION_MS]}ms * var(--k))`);
    }
  });

  it("the easings, the Slow multiplier and the reduced-motion rule are the designs'", () => {
    expect(declared("--m-out")).toBe(EASING.out);
    expect(declared("--m-io")).toBe(EASING.io);
    expect(declared("--k")).toBe("1");
    expect(css).toContain(`html.slow { --k: ${SLOW_FACTOR}; }`);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition-property: opacity, color, background-color, border-color, box-shadow, fill, stroke !important/);
  });

  it("the hour height and the phone breakpoint match the stylesheets", () => {
    expect(declared("--hour")).toBe(`${HOUR_PX}px`);
    expect(app).toContain(`@media (max-width: ${PHONE_MAX_PX}px)`);
  });

  it("the red button's three fills, per theme, are the designs' (white text on each is at least 4.5:1)", () => {
    const block = (theme: string) => {
      const start = theme === "light" ? css.indexOf(":root,\n:root[data-theme=\"light\"]") : css.indexOf(`:root[data-theme="${theme}"]`);
      return css.slice(start, css.indexOf("\n}", start));
    };
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const [theme, fill] of Object.entries(DANGER_FILL)) {
      const b = block(theme);
      expect(b, theme).toContain(`--danger-bg: ${fill.bg}; --danger-bg-hover: ${fill.hover}; --danger-bg-press: ${fill.press};`);
      for (const hex of [fill.bg, fill.hover, fill.press]) expect(1.05 / (luminance(hex) + 0.05), `${theme} ${hex}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(app).toMatch(/\.danger \{[^}]*background: var\(--danger-bg\)/);
    expect(app).toContain(".danger:hover:not(:disabled) { background: var(--danger-bg-hover); }");
    expect(app).toContain(".danger:active:not(:disabled) { background: var(--danger-bg-press); }");
  });

  it("small amber text has its own token, darker than --amber in light and equal to it in dark and dim", () => {
    expect(css).toMatch(/--amber: #c2710a; --amber-text: #9a5705;/);
    expect(css).toMatch(/:root\[data-theme="dark"\][\s\S]*--amber: #fbbf24; --amber-text: #fbbf24;/);
    expect(css).toMatch(/:root\[data-theme="dim"\][\s\S]*--amber: hsl\(40 78% 63%\); --amber-text: hsl\(40 78% 63%\);/);
    // No text uses the fill colour: every `color: var(--amber…)` is --amber-text.
    expect(app).not.toMatch(/[^-]color:\s*var\(--amber\)/);
  });
});
