import { useCallback, useRef, useState } from "react";

/** Consecutive failed polls before an error is surfaced (≈ two intervals). */
const FAILURES_BEFORE_ERROR = 2;

/**
 * Error state for a polled resource that shrugs off a single missed poll.
 *
 * The backend restarts on file changes in dev (`uvicorn --reload`), so an
 * occasional request lands in the restart window and fails. Surfacing that as an
 * error makes the app look broken; instead we keep the last data and only show
 * an error once several polls in a row fail (a real outage).
 */
export function useTransientError() {
  const failures = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const reportSuccess = useCallback(() => {
    failures.current = 0;
    setError((current) => (current === null ? current : null));
  }, []);

  const reportFailure = useCallback((message: string) => {
    failures.current += 1;
    if (failures.current >= FAILURES_BEFORE_ERROR) setError(message);
  }, []);

  return { error, reportSuccess, reportFailure };
}
