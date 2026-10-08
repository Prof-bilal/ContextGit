import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HarnessLimits, type Session } from "@/lib/api";

const BACKEND_HARNESSES = new Set(["freebuff", "commandcode", "cline"]);

/** Account queries are cached; local observers can be read without vendor traffic. */
export function useLimits(enabled: boolean, selected?: Session | null) {
  const [limits, setLimits] = useState<HarnessLimits[]>([]);
  const [local, setLocal] = useState<HarnessLimits | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const localRequest = useRef(0);
  const harness = selected?.agent ?? "shell";
  const sessionId = selected?.id;

  const load = useCallback(async (refresh: boolean) => {
    const ticket = ++request.current;
    setLoading(true);
    const results = await Promise.allSettled([
      api.limits(refresh),
      window.contextgit?.harnessUsage("codex", undefined, refresh),
    ]);
    if (request.current !== ticket) return;
    setLimits((current) => {
      const next = new Map(current.map((value) => [value.harness, value]));
      if (results[0].status === "fulfilled") for (const value of results[0].value) next.set(value.harness, value);
      else for (const [key, value] of next) if (BACKEND_HARNESSES.has(key)) next.set(key, { ...value, stale: true, message: "Backend usage refresh failed." });
      if (results[1].status === "fulfilled" && results[1].value) next.set("codex", results[1].value);
      else if (results[1].status === "rejected" && next.has("codex")) next.set("codex", { ...next.get("codex")!, stale: true, message: "Codex usage refresh failed." });
      return [...next.values()];
    });
    setError(results[0].status === "rejected" ? "Could not refresh backend account limits." : null);
    setLoading(false);
  }, []);

  const loadLocal = useCallback(async (refresh: boolean) => {
    if (!sessionId || harness === "codex" || BACKEND_HARNESSES.has(harness) || !window.contextgit) return;
    const ticket = ++localRequest.current;
    try {
      const value = await window.contextgit.harnessUsage(harness, sessionId, refresh);
      if (ticket === localRequest.current) setLocal({ ...value, session_id: sessionId });
    } catch {
      if (ticket === localRequest.current) setLocal((current) => current ? { ...current, stale: true, message: "Local usage refresh failed." } : null);
    }
  }, [harness, sessionId]);

  useEffect(() => {
    if (!enabled) return;
    void load(false);
    const timer = setInterval(() => void load(false), 300_000);
    return () => { clearInterval(timer); request.current++; };
  }, [enabled, load]);
  useEffect(() => {
    setLocal(null);
    if (!enabled) return;
    void loadLocal(false);
    const timer = setInterval(() => void loadLocal(false), 2000);
    return () => { clearInterval(timer); localRequest.current++; };
  }, [enabled, loadLocal]);

  const displayed = local && local.session_id === sessionId
    ? [...limits.filter((entry) => entry.harness !== harness), local]
    : limits;
  return { limits: displayed, loading, error, refresh: () => { void load(true); void loadLocal(true); } };
}
