/** Restfox sidecar (embedded API client) status, shared with the renderer. */

export interface RestfoxStatus {
  /** The web-standalone entry was found on disk. */
  available: boolean;
  running: boolean;
  url: string | null;
}

export interface RestfoxStartResult {
  ok: boolean;
  url?: string;
  error?: string;
}
