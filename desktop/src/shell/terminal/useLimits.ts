import { mergeUsageReadings, displayedUsageReadings } from "../../../shared/usage";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HarnessLimits, type Session } from "@/shared/api";

const BACKEND_HARNESSES = new Set(["freebuff", "commandcode", "cline", "codex"]);

/** Local observers publish events. Account reads have independent schedules. */
export function useLimits(enabled: boolean, selected?: Session | null) {
  const [readings, setReadings] = useState<HarnessLimits[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = useRef(0);
  const mounted = useRef(true);
  const harness = selected?.agent ?? "shell";
  const sessionId = selected?.id;
  const selectedSession = useRef(sessionId);
  selectedSession.current = sessionId;
  const merge = useCallback((value: HarnessLimits) => {
    if (!mounted.current || (value.scope !== "account" && value.session_id && value.session_id !== selectedSession.current)) return;
    setReadings(current => mergeUsageReadings(current, value));
  }, []);
  const read = useCallback(async (id: string, refresh: boolean, local = false) => {
    const ticket = selection.current;
    if (id === harness) setLoading(true);
    try {
      for (const value of await api.limits(refresh, id)) if (!local || ticket === selection.current) merge(value);
    } catch {
      if (mounted.current && (!local || ticket === selection.current)) {
        setError(`Could not refresh ${id} usage.`);
        setReadings(current => current.map(value => value.harness === id && (!local || value.session_id === sessionId) ? { ...value, stale: true } : value));
      }
    } finally { if (mounted.current && id === harness && ticket === selection.current) setLoading(false); }
  }, [sessionId, harness, merge]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = window.contextgit?.onUsage?.(merge);
    return () => { mounted.current = false; unsubscribe?.(); };
  }, [merge]);
  useEffect(() => {
    if (!enabled) return;
    // Publish independently: one slow provider never holds the other badges back.
    const load = () => { for (const id of BACKEND_HARNESSES) void read(id, false); };
    load();
    const timer = setInterval(load, 300_000);
    return () => clearInterval(timer);
  }, [enabled, read]);
  useEffect(() => {
    selection.current++;
    if (!enabled) return;
    const local = harness !== "codex" && !BACKEND_HARNESSES.has(harness);
    void read(harness, false, local); // Initial observer snapshot before events.
    const timer = setInterval(() => void read(harness, false, local), 30_000);
    return () => { clearInterval(timer); selection.current++; };
  }, [enabled, harness, sessionId, read]);
  const refresh = async () => {
    setLoading(true); setError(null);
    await Promise.allSettled([
      ...[...BACKEND_HARNESSES].map(id => read(id, true)),
      ...(!BACKEND_HARNESSES.has(harness) && harness !== "codex" ? [read(harness, true, true)] : []),
    ]);
    if (mounted.current) setLoading(false);
  };
  const limits = displayedUsageReadings(readings, sessionId);
  return { limits, loading, error, refresh };
}
