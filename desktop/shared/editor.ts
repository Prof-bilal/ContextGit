export interface EditorStatus {
  state: "starting" | "ready" | "stopped" | "error" | "unavailable" | "retained";
  instanceId?: string;
  url?: string;
  message?: string;
}
