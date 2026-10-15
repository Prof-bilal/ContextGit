import { mergeUsageReadings, displayedUsageReadings } from "../../../shared/usage";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HarnessLimits, type Session } from "@/shared/api";

const BACKEND_HARNESSES = new Set(["freebuff", "commandcode", "cline", "codex"]);

/** Local observers publish events. Account reads have independent schedules. */
export function useLimits(enabled: boolean, selected?: Session | null) {
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const active = enabled && visible;
  const [readings, setReadings] = useState<HarnessLimits[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = useRef(0);
  const mounted = useRef(true);
  const harness = selected?.agent ?? "shell";
  const sessionId = selected?.id;
  const selectedSession = useRef(sessionId);
  const requests = useRef(new Map<string, Promise<HarnessLimits[]>>());
  const snapshots = useRef(new Map<string, { at: number; readings: HarnessLimits[] }>());
  const accountReadAt = useRef(0);
  selectedSession.current = sessionId;
  const merge = useCallback((value: HarnessLimits) => {
    if (!mounted.current || (value.scope !== "account" && value.session_id && value.session_id !== selectedSession.current)) return;
    setReadings(current => mergeUsageReadings(current, value));
  }, []);
  const read = useCallback(async (id: string, refresh: boolean, local = false) => {
    const ticket = selection.current;
    if (id === harness) setLoading(true);
    try {
      const key = `${id}:${refresh}`;
      const cached = snapshots.current.get(id);
      if (!refresh && cached && Date.now() - cached.at < 30000) {
        for (const value of cached.readings) if (!local || ticket === selection.current) merge(value);
        return;
      }
      let pending = requests.current.get(key);
      if (!pending) {
        pending = api.limits(refresh, id).finally(() => { requests.current.delete(key); });
        requests.current.set(key, pending);
      }
      const next = await pending;
      snapshots.current.set(id, { at: Date.now(), readings: next });
      for (const value of next) if (!local || ticket === selection.current) merge(value);
    } catch {
      if (mounted.current && (!local || ticket === selection.current)) {
        setError(`Could not refresh ${id} usage.`);
        setReadings(current => current.map(value => value.harness === id && (!local || value.session_id === sessionId) ? { ...value, stale: true } : value));
      }
    } finally { if (mounted.current && id === harness && ticket === selection.current) setLoading(false); }
  }, [sessionId, harness, merge]);
  const latestRead = useRef(read);
  latestRead.current = read;
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = window.contextgit?.onUsage?.(merge);
    return () => { mounted.current = false; unsubscribe?.(); };
  }, [merge]);
  useEffect(() => {
    if (!active) return;
    // Publish independently: one slow provider never holds the other badges back.
    let timer: ReturnType<typeof setTimeout>;
    const load = () => {
      if (Date.now() - accountReadAt.current >= 300000) {
        accountReadAt.current = Date.now();
        for (const id of BACKEND_HARNESSES) void latestRead.current(id, false);
      }
      timer = setTimeout(load, Math.max(1, 300000 - (Date.now() - accountReadAt.current)));
    };
    load();
    return () => clearTimeout(timer);
  }, [active]);
  useEffect(() => {
    selection.current++;
    if (!active) return;
    const local = harness !== "codex" && !BACKEND_HARNESSES.has(harness);
    void read(harness, false, local); // Initial observer snapshot before events.
    const timer = setInterval(() => void read(harness, false, local), 30_000);
    return () => { clearInterval(timer); selection.current++; };
  }, [active, harness, sessionId, read]);
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
