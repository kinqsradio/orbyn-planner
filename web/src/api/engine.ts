import type { Health } from "../generated/Health";

export const HEALTH_TIMEOUT_MS = 10_000;

export function engineUrl(): string {
  return import.meta.env.VITE_ENGINE_URL ?? "http://localhost:8080";
}

const STATES = ["ok", "unavailable"];

function isHealth(value: unknown): value is Health {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === "string" &&
    typeof v.status === "string" && STATES.includes(v.status) &&
    typeof v.database === "string" && STATES.includes(v.database)
  );
}

/** GET /health. Gives up after ten seconds; a bad answer throws. */
export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const timeout = AbortSignal.timeout(HEALTH_TIMEOUT_MS);
  const response = await fetch(`${engineUrl()}/health`, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Engine health check failed (${response.status})`);
  const body: unknown = await response.json();
  if (!isHealth(body)) throw new Error("Engine health check returned an unexpected answer");
  return body;
}
