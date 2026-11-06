import type { Health } from "../generated/Health";

export function engineUrl(): string {
  return import.meta.env.VITE_ENGINE_URL ?? "http://localhost:8080";
}

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const response = await fetch(`${engineUrl()}/health`, { signal });
  if (!response.ok) throw new Error(`Engine health check failed (${response.status})`);
  return (await response.json()) as Health;
}
