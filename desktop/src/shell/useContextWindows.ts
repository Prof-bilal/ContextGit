import { useEffect, useState } from "react";
import { api, type ContextWindowReading, type Session } from "@/shared/api";

export function useContextWindows(sessions: Session[], enabled = true) {
  const [readings, setReadings] = useState<Record<string, ContextWindowReading>>({});
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void Promise.all(sessions.filter(session => session.kind !== "terminal").map(async session => {
      try {
        const reading = await api.contextWindow(session.id);
        if (alive) setReadings(current => ({ ...current, [session.id]: reading }));
      } catch { /* A disconnected backend should not break the tabs. */ }
    }));
    return () => { alive = false; };
  }, [enabled, sessions]);
  return readings;
}
