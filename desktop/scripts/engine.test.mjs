import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contentSecurityPolicy, engineOrigin } from "./engine.mjs";

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

test("the CSP in tauri.conf.json is the one for the default engine address", () => {
  const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
  // The checked-in file is the development default; real builds get their policy from scripts/tauri.mjs.
  assert.equal(conf.app.security.csp, contentSecurityPolicy(config.engineUrl, { allowLocalHttp: true }));
  assert.equal(conf.app.security.devCsp, contentSecurityPolicy(config.engineUrl, { dev: true }));
});
