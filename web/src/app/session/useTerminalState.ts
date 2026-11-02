import { useCallback, useSyncExternalStore } from "react";
import { terminalRuntime, type RuntimeSnapshot } from "../../shell/terminal/runtime";

/** The live PTY state of one session (only the state string, so output bytes do not re-render). */
export function useTerminalState(sessionId: string): RuntimeSnapshot["state"] {
  const subscribe = useCallback((listener: () => void) => terminalRuntime.subscribe(sessionId, listener), [sessionId]);
  return useSyncExternalStore(subscribe, () => terminalRuntime.snapshot(sessionId).state);
}
