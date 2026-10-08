import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function repositoryId(directory: string): string {
  const resolved = fs.existsSync(directory) ? fs.realpathSync(directory) : path.resolve(directory);
  return createHash("sha256").update(resolved).digest("hex");
}

export interface BackendIdentity { repoId: string; instanceId: string }

/** Probe the API contract, repository and browser access, not just an open socket. */
export async function validateBackend(
  base: string, expectedRepo: string, origin: string, fetcher: typeof fetch = fetch,
): Promise<BackendIdentity> {
  const response = await fetcher(`${base}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`Backend health failed (HTTP ${response.status}).`);
  const value = await response.json() as Record<string, unknown>;
  if (value.service !== "contextgit" || value.api_version !== "1" || value.status !== "ok") {
    throw new Error("This port is serving an incompatible backend. Stop the old backend or choose another CONTEXTGIT_PORT.");
  }
  if (value.repo_id !== expectedRepo || typeof value.instance_id !== "string") {
    throw new Error("This backend belongs to a different repository. Use the matching CONTEXTGIT_REPO or choose another port.");
  }
  const preflight = await fetcher(`${base}/api/v1/sessions`, {
    method: "OPTIONS", signal: AbortSignal.timeout(2000),
    headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  if (!preflight.ok || preflight.headers.get("access-control-allow-origin") !== origin) {
    throw new Error(`Backend CORS rejected the renderer origin ${origin}. Check CONTEXTGIT_CORS_ORIGINS.`);
  }
  const sessions = await fetcher(`${base}/api/v1/sessions`, {
    signal: AbortSignal.timeout(2000), headers: { Origin: origin },
  });
  if (!sessions.ok) throw new Error(`Backend session loading failed (HTTP ${sessions.status}). Check backend logs.`);
  if (sessions.headers.get("access-control-allow-origin") !== origin) {
    throw new Error("Backend session responses lack CORS headers. Restart with the updated backend.");
  }
  if (!Array.isArray(await sessions.json())) throw new Error("Backend returned an invalid session list.");
  return { repoId: String(value.repo_id), instanceId: value.instance_id };
}
