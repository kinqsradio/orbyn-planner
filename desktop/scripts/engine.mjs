// The engine address and the content security policy that follows from it.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Reads the engine URL, from ORBYN_ENGINE_URL or config.json, and refuses anything but an http(s)
 * origin. Plain http:// is refused too, except for localhost and 127.0.0.1 when `allowLocalHttp` is
 * set (development): a shipped app must not talk to its engine without TLS.
 */
export function engineOrigin(url, { allowLocalHttp = false } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`The engine URL "${url}" is not a web address.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`The engine URL must start with http:// or https://, not ${parsed.protocol}//.`);
  }
  if (parsed.protocol === "http:" && !(allowLocalHttp && LOCAL_HOSTS.has(parsed.hostname))) {
    throw new Error(
      allowLocalHttp
        ? `The engine URL must be https://, or http:// on localhost or 127.0.0.1 in development, not ${parsed.origin}.`
        : `A production build needs an https:// engine URL (set ORBYN_ENGINE_URL), not ${parsed.origin}.`,
    );
  }
  if (parsed.username || parsed.password) throw new Error("The engine URL must not contain a user name or password.");
  const socket = parsed.protocol === "https:" ? "wss:" : "ws:";
  return { http: parsed.origin, socket: `${socket}//${parsed.host}` };
}

/**
 * Throws if a policy names a local address. A release build must carry only the configured engine
 * origin, never localhost, 127.0.0.1 or ::1. The one allowed exception is `http://ipc.localhost`,
 * the address Tauri's own channel uses on Windows.
 */
export function assertNoLocalAddress(csp) {
  const stripped = csp.replaceAll("http://ipc.localhost", "");
  const local = stripped.match(/localhost|127\.0\.0\.1|\[::1\]/i);
  if (local) {
    throw new Error(
      `A release build's content security policy must not allow ${local[0]}: ` +
        "point ORBYN_ENGINE_URL (or desktop/config.json) at the real engine, or use `npm run dev`.",
    );
  }
}

/**
 * The CSP for the desktop window: itself, and the engine to talk to. Nothing else is loaded or
 * contacted. `ipc:` is Tauri's own channel between the page and the shell. With no `engineUrl` the
 * window can reach no engine at all: that is what the checked-in tauri.conf.json carries, so a
 * build that skips scripts/tauri.mjs fails closed. A release build (`dev` unset) is refused if
 * its policy would allow a local address; only a development build adds localhost.
 */
export function contentSecurityPolicy(engineUrl, { dev = false, allowLocalHttp = dev } = {}) {
  const connect = ["'self'", "ipc:", "http://ipc.localhost"];
  if (engineUrl) {
    const engine = engineOrigin(engineUrl, { allowLocalHttp });
    connect.push(engine.http, engine.socket);
  }
  // The dev server pushes updates over its own socket.
  if (dev) connect.push("http://localhost:5173", "ws://localhost:5173");
  const csp = [
    "default-src 'self'",
    // 'wasm-unsafe-eval' lets the page compile the engine's WebAssembly module (sign-in and device keys). It does
    // not allow eval() or inline scripts.
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
  ].join("; ");
  if (!dev && !allowLocalHttp) assertNoLocalAddress(csp);
  return csp;
}
