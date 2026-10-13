import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectState } from "./useProjectState";

/** Fire-and-forget UI actions report failures locally, including synchronous throws. */
export function useFeatureAction() {
  const [error, setError] = useProjectState<string | null>(null);
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
  }, [setError]);
  return { error, run };
}
