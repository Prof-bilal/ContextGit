/** Backend lifecycle status pushed from the Electron main process. */
export type BackendStatus =
  | { state: "starting"; message?: string }
  | { state: "ready"; apiBase: string; repoId?: string; instanceId?: string }
  | { state: "error"; message: string };
