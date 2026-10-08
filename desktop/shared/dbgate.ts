/** DbGate sidecar (embedded database client) status, shared with the renderer. */

export interface DbGateStatus {
  /** The dbgate-serve entry was found on disk. */
  available: boolean;
  running: boolean;
  url: string | null;
}

export interface DbGateStartResult {
  ok: boolean;
  url?: string;
  error?: string;
}
