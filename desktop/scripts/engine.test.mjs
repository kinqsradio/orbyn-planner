import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertNoLocalAddress, contentSecurityPolicy, engineOrigin } from "./engine.mjs";

test("the engine origin and its socket", () => {
  assert.deepEqual(engineOrigin("http://localhost:8080/some/path?q=1", { allowLocalHttp: true }), { http: "http://localhost:8080", socket: "ws://localhost:8080" });
  assert.deepEqual(engineOrigin("https://engine.example.com"), { http: "https://engine.example.com", socket: "wss://engine.example.com" });
});

test("plain http:// is refused for a production build, and in development unless it is local", () => {
  assert.throws(() => engineOrigin("http://localhost:8080"), /https:\/\//);
  assert.throws(() => engineOrigin("http://127.0.0.1:8080"), /https:\/\//);
  assert.throws(() => contentSecurityPolicy("http://engine.example.com"), /https:\/\//);
  assert.throws(() => contentSecurityPolicy("http://engine.example.com", { dev: true }), /localhost or 127\.0\.0\.1/);
  assert.throws(() => contentSecurityPolicy("http://localhost.evil.example", { dev: true }), /localhost or 127/);
  assert.doesNotThrow(() => contentSecurityPolicy("http://localhost:8080", { dev: true }));
  assert.doesNotThrow(() => contentSecurityPolicy("http://127.0.0.1:8080", { dev: true }));
  assert.doesNotThrow(() => contentSecurityPolicy("https://engine.example.com"));
});

test("anything but a plain http(s) address is refused", () => {
  for (const bad of ["", "engine", "file:///etc/passwd", "javascript:alert(1)", "ftp://x.test", "https://user:pass@x.test"]) {
    assert.throws(() => engineOrigin(bad), undefined, bad);
  }
});

test("the CSP allows itself and the engine and nothing else", () => {
  const csp = contentSecurityPolicy("https://engine.example.com");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self' ipc: http:\/\/ipc\.localhost https:\/\/engine\.example\.com wss:\/\/engine\.example\.com(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-src 'none'/);
  assert.doesNotMatch(csp, /\*/);
  assert.doesNotMatch(csp, /localhost:5173/);
  // WebAssembly may be compiled; eval and inline scripts may not.
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'(;|$)/);
  assert.doesNotMatch(csp.split("; ").find((d) => d.startsWith("script-src")), /'unsafe-eval'|'unsafe-inline'/);
});

test("only the development CSP knows the dev server", () => {
  assert.match(contentSecurityPolicy("http://localhost:8080", { dev: true }), /ws:\/\/localhost:5173/);
});

test("a release build's policy has only the engine origin, never a local address", () => {
  const csp = contentSecurityPolicy("https://engine.example.com");
  assert.doesNotMatch(csp.replaceAll("http://ipc.localhost", ""), /localhost|127\.0\.0\.1|\[::1\]/);
  // A release build that would carry one is refused, whatever the address.
  for (const url of ["https://localhost:8443", "https://127.0.0.1", "https://[::1]:8443", "https://app.localhost"]) {
    assert.throws(() => contentSecurityPolicy(url), /must not allow/, url);
  }
  assert.throws(() => assertNoLocalAddress("connect-src 'self' http://localhost:8080"), /must not allow localhost/);
  assert.doesNotThrow(() => assertNoLocalAddress("connect-src 'self' ipc: http://ipc.localhost https://engine.example.com"));
  // Development builds add localhost on purpose.
  assert.match(contentSecurityPolicy("http://localhost:8080", { dev: true }), /http:\/\/localhost:8080/);
});

test("with no engine the window can reach none", () => {
  assert.match(contentSecurityPolicy(undefined), /connect-src 'self' ipc: http:\/\/ipc\.localhost(;|$)/);
});

test("the checked-in tauri.conf.json carries no local engine address in its release policy", () => {
  const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  // The release policy in the file is the closed one: a build that skips scripts/tauri.mjs reaches
  // no engine, and real builds get theirs from the script. Only the development policy knows localhost.
  assert.equal(conf.app.security.csp, contentSecurityPolicy(undefined));
  assert.doesNotThrow(() => assertNoLocalAddress(conf.app.security.csp));
  assert.equal(conf.app.security.devCsp, contentSecurityPolicy(config.engineUrl, { dev: true }));
});

test("the build script refuses a release build for a local or plain-http engine", () => {
  const run = (url, command) =>
    spawnSync(process.execPath, [fileURLToPath(new URL("./tauri.mjs", import.meta.url)), command, "--help-not-run"], {
      env: { ...process.env, ORBYN_ENGINE_URL: url },
      encoding: "utf8",
    });
  const refused = run("https://localhost:8443", "build");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /must not allow localhost/);
  const plain = run("http://engine.example.com", "build");
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /https:\/\//);
});
