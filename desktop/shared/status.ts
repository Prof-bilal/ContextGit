/** Backend lifecycle status pushed from the Electron main process. */
export type BackendStatus =
  | { state: "starting"; message?: string }
  | { state: "ready"; apiBase: string }
  | { state: "error"; message: string };
