// The engine address and the content security policy that follows from it.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Whether a URL hostname (as `new URL` normalises it) names this machine: localhost and any
 * *.localhost name, all of 127.0.0.0/8, 0.0.0.0, ::1, :: and IPv4-mapped forms of those. A name
 * that only resolves to loopback can't be caught here; whoever sets the engine URL controls that.
 */
export function isLocalHost(hostname) {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = (text) => {
    const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
    if (!m) return false;
    const [a, b, c, d] = m.slice(1).map(Number);
    return a === 127 || (a === 0 && b === 0 && c === 0 && d === 0);
  };
  if (v4(host)) return true;
  if (host === "::1" || host === "::") return true;
  // IPv4-mapped, which URL writes in hex: ::ffff:7f00:1 is 127.0.0.1.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return v4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  return dotted ? v4(dotted[1]) : false;
}

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
export function contentSecurityPolicy(engineUrl, { dev = false, allowLocalHttp = dev, windows = process.platform === "win32" } = {}) {
  // Tauri's channel is ipc: on macOS and Linux. Only Windows (WebView2) serves it as
  // http://ipc.localhost; elsewhere that is an ordinary origin that resolves to this machine.
  const connect = ["'self'", "ipc:"];
  if (windows) connect.push("http://ipc.localhost");
  if (engineUrl) {
    const engine = engineOrigin(engineUrl, { allowLocalHttp });
    if (!dev && isLocalHost(new URL(engine.http).hostname)) {
      throw new Error(
        `A release build's engine must not be this machine (${engine.http}): ` +
          "point ORBYN_ENGINE_URL (or desktop/config.json) at the real engine, or use `npm run dev`.",
      );
    }
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
