// Builds orbyn-engine's orbyn-wasm crate into src/generated/wasm/ (the committed JavaScript package).
// With --check it builds into a temporary folder and fails if src/generated/wasm differs, like generate:check.
//
// The committed .wasm is the Linux build (the CI job rebuilds on Linux and requires it to be byte for byte the
// same), from the engine commit in the manifest; moving that pin is a deliberate `npm run wasm` on Linux.
//
// Next to the package is manifest.json: the engine commit it was built from, the Rust and wasm-bindgen
// versions, and the sha256 of each file. The check compares the JavaScript glue and the type files exactly,
// whatever the machine: a change in the module's interface always shows there; and the .wasm byte for byte,
// from exactly the pinned commit with nothing changed. `--local` (not on Linux, not in CI) lets a .wasm that differs
// only in its bytes pass with a warning, because the same source lays its data out differently on another system.
//
// The build follows the engine's crates/orbyn-wasm/README.md: cargo build for wasm32-unknown-unknown, then
// the wasm-bindgen CLI (--target web). To make the bytes the same on any machine it
//  - uses the Rust and wasm-bindgen versions pinned in wasm.lock.json (wasm-bindgen's CLI must match the crate
//    version in the engine's Cargo.lock; the script checks this),
//  - keeps the engine's getrandom flag (an environment RUSTFLAGS would replace the engine's .cargo/config.toml),
//  - and rewrites build-machine paths in the output.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const check = process.argv.includes("--check");
// --local: a run on a machine other than Linux, where the same source can lay out the .wasm differently. It lets
// a .wasm that differs only in its bytes pass with a warning if the engine commit and toolchain are the pinned ones.
// Without it (and always in CI) the check is strict: every file byte for byte, from exactly the pinned commit.
const local = process.argv.includes("--local") && process.platform !== "linux" && !process.env.CI;
if (process.argv.includes("--local") && !local) console.warn("wasm: --local is ignored on Linux and in CI; the check is strict.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(root, "wasm.lock.json"), "utf8"));
const target = join(root, "src/generated/wasm");
const FILES = ["orbyn_wasm.js", "orbyn_wasm.d.ts", "orbyn_wasm_bg.wasm", "orbyn_wasm_bg.wasm.d.ts"];
const MANIFEST = "manifest.json";
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const dir = process.env.ORBYN_ENGINE_DIR;
if (!dir) {
  console.error("wasm: set ORBYN_ENGINE_DIR to an orbyn-engine checkout.");
  process.exit(1);
}
const engine = resolve(dir);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
  if (result.status !== 0) {
    console.error(`wasm: \`${command} ${args.join(" ")}\` failed.`);
    process.exit(result.status ?? 1);
  }
}

// The CLI and the crate must be the same version.
const cargoLock = readFileSync(join(engine, "Cargo.lock"), "utf8");
const crateVersion = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(cargoLock)?.[1];
if (crateVersion !== lock.wasmBindgen) {
  console.error(`wasm: the engine's Cargo.lock has wasm-bindgen ${crateVersion}, but wasm.lock.json pins ${lock.wasmBindgen}. Update wasm.lock.json and the CI tool version together.`);
  process.exit(1);
}
const cli = spawnSync("wasm-bindgen", ["--version"], { encoding: "utf8" });
if (cli.status !== 0 || !cli.stdout.includes(lock.wasmBindgen)) {
  console.error(`wasm: install the wasm-bindgen CLI ${lock.wasmBindgen}: cargo install wasm-bindgen-cli --version ${lock.wasmBindgen} --locked`);
  process.exit(1);
}

const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
const rustup = process.env.RUSTUP_HOME ?? join(homedir(), ".rustup");
// \x1f separates arguments, so paths with spaces survive.
const rustflags = [
  "--cfg", 'getrandom_backend="wasm_js"',
  `--remap-path-prefix=${engine}=/engine`,
  `--remap-path-prefix=${cargoHome}=/cargo`,
  `--remap-path-prefix=${rustup}=/rustup`,
].join("\x1f");

const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: rustflags, CARGO_BUILD_TARGET_DIR: process.env.ORBYN_WASM_TARGET_DIR ?? join(engine, "target") };
delete env.RUSTFLAGS;
run("cargo", [`+${lock.rust}`, "build", "-p", "orbyn-wasm", "--release", "--target", "wasm32-unknown-unknown", "--locked"], { cwd: engine, env });

const out = mkdtempSync(join(tmpdir(), "orbyn-wasm-"));
try {
  run("wasm-bindgen", ["--target", "web", "--out-dir", out, join(env.CARGO_BUILD_TARGET_DIR, "wasm32-unknown-unknown/release/orbyn_wasm.wasm")]);
  const missing = FILES.filter((f) => !existsSync(join(out, f)));
  if (missing.length > 0) {
    console.error(`wasm: wasm-bindgen did not make ${missing.join(", ")}`);
    process.exit(1);
  }
  const head = spawnSync("git", ["-C", engine, "rev-parse", "HEAD"], { encoding: "utf8" });
  const commit = head.status === 0 ? head.stdout.trim() : "unknown";
  if (check) {
    const have = existsSync(target) ? readdirSync(target) : [];
    const manifestPath = join(target, MANIFEST);
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
    const problems = [];
    if (!manifest) problems.push(`${MANIFEST} is missing`);
    // What is committed must be what the manifest says.
    for (const f of FILES) {
      if (!have.includes(f)) problems.push(`${f} is missing`);
      else if (manifest && sha(join(target, f)) !== manifest.files?.[f]) problems.push(`${f} does not match ${MANIFEST}`);
    }
    for (const f of have) if (!FILES.includes(f) && f !== MANIFEST) problems.push(`${f} is not part of the package`);
    // The glue and the types must equal a fresh build exactly.
    for (const f of FILES.filter((f) => f !== "orbyn_wasm_bg.wasm" && have.includes(f))) {
      if (!readFileSync(join(out, f)).equals(readFileSync(join(target, f)))) problems.push(`${f} differs from a fresh build`);
    }
    // The engine checkout must be exactly the commit the package was built from, with nothing changed.
    const dirty = spawnSync("git", ["-C", engine, "status", "--porcelain"], { encoding: "utf8" });
    const tidy = dirty.status === 0 && dirty.stdout.trim() === "";
    const pinned = manifest && manifest.engine === commit;
    if (!local) {
      if (!pinned) problems.push(`the engine checkout is at ${commit}, not at ${manifest?.engine ?? "the commit in the manifest"}`);
      if (!tidy) problems.push("the engine checkout has changes (git status --porcelain is not empty)");
    } else if (!pinned || !tidy) {
      console.warn(`wasm:check: warning: the engine checkout is ${pinned ? "" : `at ${commit}, not ${manifest?.engine}, `}${tidy ? "" : "changed, "}so this comparison is only a guide.`);
    }
    // The .wasm: byte for byte. Only a --local run on another system may accept a layout difference.
    if (have.includes("orbyn_wasm_bg.wasm") && !readFileSync(join(out, "orbyn_wasm_bg.wasm")).equals(readFileSync(join(target, "orbyn_wasm_bg.wasm")))) {
      const same = manifest && pinned && manifest.rust === lock.rust && manifest.wasmBindgen === lock.wasmBindgen && tidy;
      if (local && same) console.warn("wasm:check: warning: orbyn_wasm_bg.wasm differs byte for byte from a build on this system, but the engine commit and toolchain are the pinned ones; accepted for a local run. CI rebuilds on Linux and is strict.");
      else problems.push("orbyn_wasm_bg.wasm differs from a fresh build of the pinned commit. The committed one is the Linux build; rebuild it on Linux (see docs/architecture.md) and commit it.");
    }
    if (problems.length > 0) {
      console.error(`wasm:check: src/generated/wasm is out of date:\n  - ${problems.join("\n  - ")}\nRun npm run wasm.`);
      process.exit(1);
    }
    console.log(`wasm:check: ${FILES.length} file(s) match a fresh build of ${engine}`);
  } else {
    mkdirSync(target, { recursive: true });
    for (const f of FILES) copyFileSync(join(out, f), join(target, f));
    const files = Object.fromEntries(FILES.map((f) => [f, sha(join(target, f))]));
    writeFileSync(join(target, MANIFEST), `${JSON.stringify({ engine: commit, rust: lock.rust, wasmBindgen: lock.wasmBindgen, files }, null, 2)}\n`);
    console.log(`wasm: wrote ${FILES.length} file(s) and ${MANIFEST} to src/generated/wasm`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
