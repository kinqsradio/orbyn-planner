// @vitest-environment node
import { describe, expect, it } from "vitest";

const nodeFs = "node:fs";
const nodePath = "node:path";
const fs = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(p: string, e: "utf8"): string; readdirSync(p: string, o: { recursive: true }): string[] };
const path = (await import(/* @vite-ignore */ nodePath)) as { join(...p: string[]): string };
const SRC = path.join((globalThis as unknown as { process: { cwd(): string } }).process.cwd(), "src");

describe("text uses t1 to t3; t4 is for icons, borders and dividers", () => {
  const files = fs.readdirSync(SRC, { recursive: true }).filter((f) => /\.(tsx|css)$/.test(f) && !/\.test\./.test(f));

  it("no component puts t4 on text: no t4 class and no inline color of --t4", () => {
    for (const f of files.filter((f) => f.endsWith(".tsx"))) {
      const text = fs.readFileSync(path.join(SRC, f), "utf8");
      expect(text, f).not.toMatch(/className="[^"]*\bt4\b/);
      expect(text, f).not.toMatch(/color:\s*["']?var\(--t4\)/);
    }
  });

  it("a done row is struck through in its own text colour, not a paler line", () => {
    const css = fs.readFileSync(path.join(SRC, "styles/app.css"), "utf8");
    const rule = css.slice(css.indexOf(".tr.done .tt"), css.indexOf("}", css.indexOf(".tr.done .tt")));
    expect(rule).toContain("text-decoration: line-through");
    expect(rule).not.toContain("text-decoration-color");
  });

  it("a notes textarea uses the page font, not the browser's monospace", () => {
    const css = fs.readFileSync(path.join(SRC, "styles/app.css"), "utf8");
    expect(css).toMatch(/textarea\.field\s*\{[^}]*font:\s*inherit/);
  });

  it("no rule sets the text colour to --t4", () => {
    const css = fs.readFileSync(path.join(SRC, "styles/app.css"), "utf8");
    expect(css).not.toMatch(/(^|[^-a-z])color:\s*var\(--t4\)/m);
  });
});

/** WCAG contrast of the text colour t3 on each surface, per theme, read from tokens.css. */
describe("t3 text is readable in light, dark and Dim", () => {
  const css = fs.readFileSync(path.join(SRC, "styles/tokens.css"), "utf8");
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
  const blend = (ink: number[], a: number, under: number[]) => ink.map((v, i) => v * a + under[i]! * (1 - a));
  const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const hex = (h: string) => {
    const full = h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h; // #fff or #f6f6f6
    return [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const rgba = (v: string) => v.match(/rgba\((\d+),(\d+),(\d+),([.\d]+)\)/)!.slice(1).map(Number) as [number, number, number, number];

  for (const theme of ["light", "dark", "dim"]) {
    it(`${theme}: at least 4.5:1 on the page, the main surface and a raised one`, () => {
      const block = css.slice(css.indexOf(`:root[data-theme="${theme}"]`));
      const get = (name: string) => block.match(new RegExp(`--${name}:\\s*([^;]+);`))![1]!.trim();
      const bg = hex(get("bg"));
      const main = hex(get("main"));
      const [r, g, b, a3] = rgba(get("t3"));
      const [, , , aRaise] = rgba(get("raise"));
      const ink = [r, g, b];
      const raised = blend(ink, aRaise, main);
      for (const surface of [bg, main, raised]) expect(ratio(blend(ink, a3, surface), surface)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
