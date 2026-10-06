import { useCallback, useEffect, useRef, useState } from "react";
import { LuArrowLeft, LuArrowRight, LuBug, LuHouse, LuRotateCw } from "react-icons/lu";

const VIEW_ID = "browser";

/** Start-page shortcuts: the places people actually open all day. */
const SHORTCUTS: Array<{ label: string; url: string }> = [
  { label: "Google", url: "https://www.google.com" },
  { label: "YouTube", url: "https://www.youtube.com" },
  { label: "GitHub", url: "https://github.com" },
  { label: "ChatGPT", url: "https://chatgpt.com" },
  { label: "Claude", url: "https://claude.ai" },
  { label: "Gemini", url: "https://gemini.google.com" },
  { label: "Gmail", url: "https://mail.google.com" },
  { label: "Maps", url: "https://maps.google.com" },
  { label: "Stack Overflow", url: "https://stackoverflow.com" },
  { label: "MDN", url: "https://developer.mozilla.org" },
  { label: "npm", url: "https://www.npmjs.com" },
  { label: "Reddit", url: "https://www.reddit.com" },
];

type Status = "start" | "loading" | "loaded" | "blocked" | "error";

/** A typed address or a search phrase → a URL (google search for plain words). */
function toUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

/**
 * The in-app browser. The page is a main-process `WebContentsView` (not a DOM
 * element); this renders the toolbar + start page and keeps the native view's
 * bounds glued to its host div.
 */
export default function BrowserView({
  active,
  request,
}: {
  active: boolean;
  /** A navigation asked for from elsewhere (the rail); re-fires per `nonce`. */
  request: { url: string; nonce: number } | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const createdRef = useRef(false);
  const [mode, setMode] = useState<"start" | "page">("start");
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("start");
  const [message, setMessage] = useState<string | null>(null);

  const syncBounds = useCallback(() => {
    const host = hostRef.current;
    const bridge = window.contextgit;
    if (!host || !bridge || !createdRef.current) return;
    const rect = host.getBoundingClientRect();
    bridge.viewSetBounds(VIEW_ID, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  const open = useCallback(
    (input: string) => {
      const bridge = window.contextgit;
      const url = toUrl(input);
      if (!bridge || !url) return;
      setMessage(null);
      setAddress(url);
      void (async () => {
        if (!createdRef.current) {
          createdRef.current = true;
          const created = await bridge.viewCreate(VIEW_ID, url);
          if (!created.ok) {
            createdRef.current = false;
            setStatus("blocked");
            setMessage(created.error ?? "Could not open the page");
            return;
          }
        } else {
          const loaded = await bridge.viewLoad(VIEW_ID, url);
          if (!loaded.ok) {
            setStatus("blocked");
            setMessage(loaded.error ?? "Could not open the page");
            return;
          }
        }
        setMode("page");
      })();
    },
    [],
  );

  const home = useCallback(() => {
    window.contextgit?.viewSetVisible(VIEW_ID, false);
    setMode("start");
    setStatus("start");
    setMessage(null);
  }, []);

  // Events for the life of the component; the native view dies with it.
  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge) return;
    const off = bridge.onViewEvent((event) => {
      if (event.id !== VIEW_ID) return;
      switch (event.type) {
        case "loading":
          setStatus("loading");
          break;
        case "loaded":
          setStatus("loaded");
          setAddress(event.url);
          setTitle(event.title);
          break;
        case "navigate":
          setAddress(event.url);
          break;
        case "title":
          setTitle(event.title);
          break;
        case "blocked":
          setStatus("blocked");
          setMessage(`Not allowed: ${event.url}`);
          break;
        case "error":
          setStatus("error");
          setMessage(event.error);
          break;
      }
    });
    return () => {
      off();
      if (createdRef.current) bridge.viewDestroy(VIEW_ID);
    };
  }, []);

  // Show the native view only when the tab is active and a page is open.
  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge) return;
    const show = active && mode === "page";
    bridge.viewSetVisible(VIEW_ID, show);
    if (show) requestAnimationFrame(syncBounds);
  }, [active, mode, syncBounds]);

  // Keep the native view glued to the host.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => syncBounds());
    observer.observe(host);
    window.addEventListener("resize", syncBounds);
    const raf = requestAnimationFrame(syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      cancelAnimationFrame(raf);
    };
  }, [mode, syncBounds]);

  // Navigations requested from the rail.
  useEffect(() => {
    if (request) open(request.url);
  }, [request?.nonce, request, open]);

  return (
    <div className="cg-browser">
      <div className="cg-view-toolbar">
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Home"
          title="Home"
          onClick={home}
        >
          <LuHouse aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Back"
          title="Back"
          onClick={() => window.contextgit?.viewBack(VIEW_ID)}
        >
          <LuArrowLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Forward"
          title="Forward"
          onClick={() => window.contextgit?.viewForward(VIEW_ID)}
        >
          <LuArrowRight aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Reload"
          title="Reload"
          onClick={() => window.contextgit?.viewReload(VIEW_ID)}
        >
          <LuRotateCw aria-hidden="true" />
        </button>
        <form
          className="cg-browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            open(address);
          }}
        >
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Search Google or type a URL"
            aria-label="Address"
            spellCheck={false}
          />
        </form>
        <span className="cg-toolbar-spacer" />
        <span className="cg-browser-status" data-status={status}>
          {status}
        </span>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="DevTools"
          title="Toggle DevTools"
          onClick={() => window.contextgit?.viewDevtools(VIEW_ID)}
        >
          <LuBug aria-hidden="true" />
        </button>
      </div>
      {mode === "page" && title && <div className="cg-browser-title">{title}</div>}
      {message && (
        <p className="cg-pane-error" role="alert">
          {message}
        </p>
      )}
      {mode === "start" ? (
        <div className="cg-browser-start">
          <h2>New tab</h2>
          <div className="cg-browser-tiles">
            {SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut.url}
                type="button"
                className="cg-browser-tile"
                onClick={() => open(shortcut.url)}
              >
                {shortcut.label}
              </button>
            ))}
          </div>
          <p className="cg-empty-note">
            Search or type an address above — Google, GitHub, docs, AI sites, anything.
          </p>
        </div>
      ) : (
        <div className="cg-browser-host" ref={hostRef} />
      )}
    </div>
  );
}
