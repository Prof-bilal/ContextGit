import { useCallback, useEffect, useRef, useState } from "react";

/** Fire-and-forget UI actions report failures locally, including synchronous throws. */
export function useFeatureAction() {
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const run = useCallback(async (operation: () => unknown | Promise<unknown>) => {
    try {
      await operation();
      if (mounted.current) setError(null);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  return { error, run };
}
