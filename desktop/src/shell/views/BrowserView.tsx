import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuArrowRight,
  LuBookmark,
  LuBug,
  LuHouse,
  LuPlus,
  LuRotateCw,
  LuSearch,
  LuX,
} from "react-icons/lu";

import { recordVisit, toggleBookmark, useBrowserLibrary } from "../browser/library";

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

const ZOOM_KEY = "cg.browser.zoom";

type Status = "start" | "loading" | "loaded" | "blocked" | "error";

interface Tab {
  /** Doubles as the native view's id. */
  key: string;
  title: string;
  url: string;
  status: Status;
  message: string | null;
  mode: "start" | "page";
}

/** A typed address or a search phrase → a URL (google search for plain words). */
function toUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

let seq = 0;

function makeTab(url?: string): Tab {
  return {
    key: `browser-${++seq}`,
    title: "",
    url: url ?? "",
    status: url ? "loading" : "start",
    message: null,
    mode: url ? "page" : "start",
  };
}

function readZoom(): number {
  try {
    const raw = Number(window.localStorage.getItem(ZOOM_KEY));
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    return 0;
  }
}

/**
 * The in-app browser. Each tab is a main-process `WebContentsView` (real
 * Chromium, not a DOM element); this renders the chrome — tabs, address bar,
 * find, zoom, bookmarks — and keeps the active view glued to its host div.
 */
export default function BrowserView({
  active,
  request,
  obscured,
}: {
  active: boolean;
  /** A navigation asked for from elsewhere (the rail); re-fires per `nonce`. */
  request: { url: string; nonce: number } | null;
  /** A dialog is open; hide the native view so the dialog is not covered. */
  obscured: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const created = useRef<Set<string>>(new Set());
  const [tabs, setTabs] = useState<Tab[]>(() => [makeTab()]);
  const [activeKey, setActiveKey] = useState(() => tabs[0].key);
  const [address, setAddress] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [findCount, setFindCount] = useState({ matches: 0, active: 0 });
  const [zoom, setZoom] = useState(readZoom);
  const { bookmarks } = useBrowserLibrary();

  const tab = tabs.find((entry) => entry.key === activeKey) ?? tabs[0];
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const patch = useCallback((key: string, next: Partial<Tab>) => {
    setTabs((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...next } : entry)),
    );
  }, []);

  const syncBounds = useCallback(() => {
    const host = hostRef.current;
    const bridge = window.contextgit;
    if (!host || !bridge || !created.current.has(activeKeyRef.current)) return;
    const rect = host.getBoundingClientRect();
    bridge.viewSetBounds(activeKeyRef.current, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  const navigate = useCallback(
    async (key: string, input: string) => {
      const bridge = window.contextgit;
      const url = toUrl(input);
      if (!bridge || !url) return;
      patch(key, { status: "loading", message: null, url });
      const newView = !created.current.has(key);
      try {
        if (!created.current.has(key)) {
          created.current.add(key);
          const made = await bridge.viewCreate(key, url);
          if (!made.ok) {
            created.current.delete(key);
            patch(key, { status: "blocked", message: made.error ?? "Could not open the page" });
            return;
          }
        } else {
          const loaded = await bridge.viewLoad(key, url);
          if (!loaded.ok) {
            patch(key, { status: "blocked", message: loaded.error ?? "Could not open the page" });
            return;
          }
        }
        patch(key, { mode: "page" });
      } catch (cause) {
        if (newView) created.current.delete(key);
        patch(key, { status: "error", message: cause instanceof Error ? cause.message : "Could not open the page" });
      }
    },
    [patch],
  );

  const openTab = useCallback(
    (url?: string) => {
      const fresh = makeTab(url);
      setTabs((current) => [...current, fresh]);
      setActiveKey(fresh.key);
      if (url) void navigate(fresh.key, url);
    },
    [navigate],
  );

  const closeTab = useCallback(
    (key: string) => {
      window.contextgit?.viewDestroy(key);
      created.current.delete(key);
      const index = tabs.findIndex((entry) => entry.key === key);
      const rest = tabs.filter((entry) => entry.key !== key);
      if (rest.length === 0) {
        const fresh = makeTab();
        setTabs([fresh]);
        setActiveKey(fresh.key);
        return;
      }
      setTabs(rest);
      if (key === activeKey) setActiveKey(rest[Math.min(index, rest.length - 1)].key);
    },
    [tabs, activeKey],
  );

  const goHome = useCallback(() => {
    window.contextgit?.viewSetVisible(activeKeyRef.current, false);
    patch(activeKeyRef.current, { mode: "start", status: "start", message: null, url: "" });
  }, [patch]);

  // Events for the life of the component; every view dies with it.
  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge) return;
    const off = bridge.onViewEvent((event) => {
      switch (event.type) {
        case "loading":
          patch(event.id, { status: "loading" });
          break;
        case "loaded":
          patch(event.id, { status: "loaded", url: event.url, title: event.title });
          recordVisit(event.url, event.title);
          break;
        case "navigate":
          patch(event.id, { url: event.url });
          break;
        case "title":
          patch(event.id, { title: event.title });
          break;
        case "blocked":
          patch(event.id, { status: "blocked", message: `Not allowed: ${event.url}` });
          break;
        case "error":
          patch(event.id, { status: "error", message: event.error });
          break;
        case "open":
          openTab(event.url);
          break;
        case "found":
          if (event.id === activeKeyRef.current) {
            setFindCount({ matches: event.matches, active: event.active });
          }
          break;
      }
    });
    return () => {
      off();
      for (const key of created.current) window.contextgit?.viewDestroy(key);
      created.current.clear();
    };
  }, [patch, openTab]);

  // Keep the address bar in step with the active tab.
  useEffect(() => {
    setAddress(tab.url);
  }, [tab.key, tab.url]);

  // Only the active tab is visible, and only while a page is showing.
  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge) return;
    const onPage = tab.mode === "page";
    for (const entry of tabs) {
      bridge.viewSetVisible(entry.key, active && !obscured && onPage && entry.key === tab.key);
    }
    if (active && !obscured && onPage) requestAnimationFrame(syncBounds);
  }, [tabs, tab.key, tab.mode, active, obscured, syncBounds]);

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
  }, [tab.mode, syncBounds]);

  // Find in the active page; results arrive as events.
  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge) return;
    if (findOpen) bridge.viewFind(activeKey, findText);
    else {
      bridge.viewFindStop(activeKey);
      setFindCount({ matches: 0, active: 0 });
    }
  }, [findOpen, findText, activeKey]);

  useEffect(() => {
    window.contextgit?.viewSetZoom(activeKey, zoom);
    try {
      window.localStorage.setItem(ZOOM_KEY, String(zoom));
    } catch {
      // ignore
    }
  }, [zoom, activeKey, tabs]);

  // Navigations requested from the rail.
  useEffect(() => {
    if (request) void navigate(activeKeyRef.current, request.url);
  }, [request?.nonce, request, navigate]);

  const starred = Boolean(tab.url) && bookmarks.some((entry) => entry.url === tab.url);
  const percent = Math.round(1.2 ** zoom * 100);

  return (
    <div className="cg-browser">
      <div className="cg-view-toolbar">
        <button type="button" className="cg-icon-btn" aria-label="Home" title="Home" onClick={goHome}>
          <LuHouse aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Back"
          title="Back"
          onClick={() => window.contextgit?.viewBack(activeKey)}
        >
          <LuArrowLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Forward"
          title="Forward"
          onClick={() => window.contextgit?.viewForward(activeKey)}
        >
          <LuArrowRight aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Reload"
          title="Reload"
          onClick={() => window.contextgit?.viewReload(activeKey)}
        >
          <LuRotateCw aria-hidden="true" />
        </button>
        <form
          className="cg-browser-address"
          onSubmit={(event) => {
            event.preventDefault();
            void navigate(activeKey, address);
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
        <button
          type="button"
          className="cg-icon-btn"
          aria-label={starred ? "Remove bookmark" : "Bookmark this page"}
          aria-pressed={starred}
          title={starred ? "Remove bookmark" : "Bookmark this page"}
          disabled={!tab.url}
          onClick={() => toggleBookmark(tab.url, tab.title)}
        >
          <LuBookmark aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Find in page"
          aria-pressed={findOpen}
          title="Find in page"
          disabled={tab.mode !== "page"}
          onClick={() => setFindOpen((value) => !value)}
        >
          <LuSearch aria-hidden="true" />
        </button>
        <div className="cg-browser-zoom">
          <button
            type="button"
            className="cg-icon-btn"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => setZoom((value) => Math.max(-3, value - 1))}
          >
            −
          </button>
          <button
            type="button"
            className="cg-browser-zoom-label"
            title="Reset zoom"
            onClick={() => setZoom(0)}
          >
            {percent}%
          </button>
          <button
            type="button"
            className="cg-icon-btn"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => setZoom((value) => Math.min(5, value + 1))}
          >
            +
          </button>
        </div>
        <span className="cg-toolbar-spacer" />
        <span className="cg-browser-status" data-status={tab.status}>
          {tab.status}
        </span>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="DevTools"
          title="Toggle DevTools"
          onClick={() => window.contextgit?.viewDevtools(activeKey)}
        >
          <LuBug aria-hidden="true" />
        </button>
      </div>

      <div className="cg-browser-tabs" role="tablist" aria-label="Tabs">
        {tabs.map((entry) => (
          <div
            className="cg-browser-tab"
            key={entry.key}
            role="tab"
            aria-selected={entry.key === tab.key}
          >
            <button
              type="button"
              className="cg-browser-tab-btn"
              aria-label={`Tab: ${entry.title || entry.url || "New tab"}`}
              title={entry.url || "New tab"}
              onClick={() => setActiveKey(entry.key)}
            >
              {entry.title || entry.url || "New tab"}
            </button>
            <button
              type="button"
              className="cg-browser-tab-close"
              aria-label={`Close ${entry.title || "New tab"}`}
              onClick={() => closeTab(entry.key)}
            >
              <LuX aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="cg-icon-btn cg-browser-tab-new"
          aria-label="New tab"
          title="New tab"
          onClick={() => openTab()}
        >
          <LuPlus aria-hidden="true" />
        </button>
      </div>

      {findOpen && (
        <div className="cg-browser-find">
          <input
            className="cg-input"
            value={findText}
            placeholder="Find in page"
            aria-label="Find in page"
            onChange={(event) => setFindText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") window.contextgit?.viewFind(activeKey, findText);
              if (event.key === "Escape") setFindOpen(false);
            }}
          />
          <span className="cg-view-sub">
            {findCount.matches === 0
              ? "No matches"
              : `${findCount.active} / ${findCount.matches}`}
          </span>
          <button
            type="button"
            className="cg-icon-btn"
            aria-label="Close find"
            onClick={() => setFindOpen(false)}
          >
            <LuX aria-hidden="true" />
          </button>
        </div>
      )}

      {tab.mode === "page" && tab.title && <div className="cg-browser-title">{tab.title}</div>}
      {tab.message && (
        <p className="cg-pane-error" role="alert">
          {tab.message}
        </p>
      )}
      {tab.mode === "start" ? (
        <div className="cg-browser-start">
          <h2>New tab</h2>
          <div className="cg-browser-tiles">
            {SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut.url}
                type="button"
                className="cg-browser-tile"
                onClick={() => void navigate(tab.key, shortcut.url)}
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
