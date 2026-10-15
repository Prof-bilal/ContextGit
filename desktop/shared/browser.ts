/** Legacy view contracts remain available to existing bridge consumers. */
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
  | { id: string; type: "error"; url: string; error: string }
  | { id: string; type: "open"; url: string }
  | { id: string; type: "found"; matches: number; active: number };

export interface ViewCreateResult {
  ok: boolean;
  error?: string;
}

export interface BrowserState {
  label: string;
  url: string;
  title: string;
  loading: boolean;
  error?: string | null;
}

/** Public sites default to HTTPS; loopback development servers stay on HTTP. */
export function browserAddress(input: string): string {
  const text = input.trim();
  if (!text) throw new Error("Enter a website address or search.");
  if (/^(javascript|data|file|tauri|ftp|mailto|about):/i.test(text)) throw new Error("This browser supports HTTP and HTTPS website addresses.");
  if (/^https?:\/\//i.test(text)) return new URL(text).toString();
  const loopback = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(text);
  if (!loopback && /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^\s/:]+:\d+(?:[/?#]|$)/.test(text)) {
    throw new Error("This browser supports HTTP and HTTPS website addresses.");
  }
  if (!/\s/.test(text) && (loopback || /^[^/?#\s]+\.[^/?#\s]+/.test(text))) {
    return new URL(`${loopback ? "http" : "https"}://${text}`).toString();
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}
