/** Backend lifecycle status exposed by the local API process. */
export type BackendStatus =
  | { state: "starting"; message?: string }
  | { state: "ready"; apiBase: string; repoId?: string; instanceId?: string }
  | { state: "error"; message: string };
