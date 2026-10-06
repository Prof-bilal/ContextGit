/** Editor sidecar (embedded VS Code) status, shared with the renderer. */

export interface EditorStatus {
  /** The code-server binary was found on disk. */
  available: boolean;
  running: boolean;
  url: string | null;
}

export interface EditorStartResult {
  ok: boolean;
  url?: string;
  error?: string;
}
