import { useCallback, useEffect, useRef, useState } from "react";
import { LuBug, LuRotateCw } from "react-icons/lu";

const VIEW_ID = "editor";

type State = "checking" | "absent" | "starting" | "ready" | "error";

/**
 * The Editor tab: real VS Code (a `code-server` sidecar) embedded through the
 * shared `WebContentsView` primitive. The sidecar is started on demand; until
 * then this shows a start card.
 */
export default function EditorView({ active, nonce }: { active: boolean; nonce: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const createdRef = useRef(false);
  const [state, setState] = useState<State>("checking");
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

  const show = useCallback(
    async (url: string) => {
      const bridge = window.contextgit;
      if (!bridge) return;
      if (!createdRef.current) {
        createdRef.current = true;
        const created = await bridge.viewCreate(VIEW_ID, url);
        if (!created.ok) {
          createdRef.current = false;
          setState("error");
          setMessage(created.error ?? "Could not open the editor");
          return;
        }
      }
      bridge.viewSetVisible(VIEW_ID, active);
      requestAnimationFrame(syncBounds);
      setState("ready");
    },
    [active, syncBounds],
  );

  const check = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return;
    setMessage(null);
    const status = await bridge.editorStatus();
    if (status.running && status.url) {
      await show(status.url);
      return;
    }
    setState("absent");
    if (!status.available) {
      setMessage("The editor is not installed. Run `npm run fetch:editor` in desktop/.");
    }
  }, [show]);

  const start = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return;
    setState("starting");
    setMessage(null);
    const result = await bridge.editorStart();
    if (!result.ok || !result.url) {
      setState("error");
      setMessage(result.error ?? "Could not start the editor");
      return;
    }
    await show(result.url);
  }, [show]);

  // (Re)load whenever the tab is opened or the rail asks to (re)start.
  useEffect(() => {
    void check();
  }, [check, nonce]);

  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge) return;
    const visible = active && state === "ready";
    bridge.viewSetVisible(VIEW_ID, visible);
    if (visible) requestAnimationFrame(syncBounds);
  }, [active, state, syncBounds]);

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
  }, [state, syncBounds]);

  useEffect(
    () => () => {
      if (createdRef.current) window.contextgit?.viewDestroy(VIEW_ID);
    },
    [],
  );

  return (
    <div className="cg-editor">
      <div className="cg-view-toolbar">
        <h1>Editor</h1>
        <span className="cg-view-sub">VS Code</span>
        <span className="cg-toolbar-spacer" />
        <span className="cg-browser-status" data-status={state === "ready" ? "loaded" : state}>
          {state}
        </span>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Reload editor"
          title="Reload"
          onClick={() => window.contextgit?.viewReload(VIEW_ID)}
        >
          <LuRotateCw aria-hidden="true" />
        </button>
        <button
          type="button"
          className="cg-icon-btn"
          aria-label="Editor DevTools"
          title="Toggle DevTools"
          onClick={() => window.contextgit?.viewDevtools(VIEW_ID)}
        >
          <LuBug aria-hidden="true" />
        </button>
      </div>
      {message && (
        <p className="cg-pane-error" role="alert">
          {message}
        </p>
      )}
      {state === "ready" ? (
        <div className="cg-editor-host" ref={hostRef} />
      ) : (
        <div className="cg-editor-start">
          <h2>Embedded VS Code</h2>
          <p className="cg-empty-note">
            Run real VS Code on your project folder — completions and the git graph included.
          </p>
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            disabled={state === "starting" || state === "checking"}
            onClick={() => void start()}
          >
            {state === "starting" ? "Starting…" : "Start editor"}
          </button>
        </div>
      )}
    </div>
  );
}
