import { describe, expect, it } from "vitest";

const nodeModule = (name: string) => import(/* @vite-ignore */ name) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("generate and generate:check use the pinned engine", () => {
  it("refuse an engine checkout that is not at the commit in the wasm manifest, and say which commits they are", async () => {
    const { spawnSync } = await nodeModule("node:child_process");
    const { mkdtempSync, mkdirSync, writeFileSync } = await nodeModule("node:fs");
    const { tmpdir } = await nodeModule("node:os");
    const { join } = await nodeModule("node:path");
    const dir = mkdtempSync(join(tmpdir(), "engine-"));
    mkdirSync(join(dir, "crates/orbyn-contracts/bindings"), { recursive: true });
    writeFileSync(join(dir, "crates/orbyn-contracts/bindings/X.ts"), "export type X = string;\n");
    const git = (...args: string[]) => spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "not the pin");
    const head = git("rev-parse", "HEAD").stdout.trim();
    for (const args of [["scripts/generate.mjs", "--check"], ["scripts/generate.mjs"]]) {
      const run = spawnSync("node", args, { cwd: (globalThis as unknown as { process: { cwd(): string } }).process.cwd(), env: { ...(globalThis as unknown as { process: { env: object } }).process.env, ORBYN_ENGINE_DIR: dir }, encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`is at ${head}, not the pinned engine`);
      expect(run.stderr).toContain("src/generated/wasm/manifest.json");
    }
  });
});
