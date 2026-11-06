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
 * The CSP for the desktop window: itself, and the engine to talk to. Nothing else is loaded or
 * contacted. `ipc:` is Tauri's own channel between the page and the shell.
 */
export function contentSecurityPolicy(engineUrl, { dev = false, allowLocalHttp = dev } = {}) {
  const engine = engineOrigin(engineUrl, { allowLocalHttp });
  const connect = ["'self'", "ipc:", "http://ipc.localhost", engine.http, engine.socket];
  // The dev server pushes updates over its own socket.
  if (dev) connect.push("http://localhost:5173", "ws://localhost:5173");
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
  ].join("; ");
}
