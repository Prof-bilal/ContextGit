/** In-app browser types shared by the Electron main process and the renderer. */

/** Bounds of a native `WebContentsView`, in CSS px relative to the window. */
export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ViewEvent =
  | { id: string; type: "loading" }
  | { id: string; type: "loaded"; url: string; title: string }
  | { id: string; type: "navigate"; url: string }
  | { id: string; type: "title"; title: string }
  | { id: string; type: "blocked"; url: string }
  | { id: string; type: "error"; url: string; error: string };

export interface ViewCreateResult {
  ok: boolean;
  error?: string;
}
