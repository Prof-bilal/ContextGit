import { useCallback, useEffect, useRef, useState } from "react";
import { LuBug, LuRotateCw } from "react-icons/lu";

const VIEW_ID = "restfox";

type State = "checking" | "absent" | "starting" | "ready" | "error";

/**
 * The API tab's embedded client: Restfox — a `web-standalone` sidecar shown
 * through the shared `WebContentsView` primitive, exactly like the Editor tab's
 * VS Code and the DB tab's DbGate. Started on demand; until then a start card.
 */
export default function RestfoxPanel({ obscured }: { obscured: boolean }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const createdRef = useRef(false);
  const [state, setState] = useState<State>("checking");
  const [available, setAvailable] = useState(true);
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
          setMessage(created.error ?? "Could not open Restfox");
          return;
        }
      }
      bridge.viewSetVisible(VIEW_ID, !obscured);
      requestAnimationFrame(syncBounds);
      setState("ready");
    },
    [obscured, syncBounds],
  );

  const check = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return;
    setMessage(null);
    const status = await bridge.restfoxStatus();
    setAvailable(status.available);
    if (status.running && status.url) {
      await show(status.url);
      return;
    }
    setState("absent");
    if (!status.available) {
      setMessage("Restfox is not installed. Run `npm run fetch:restfox` in desktop/.");
    }
  }, [show]);

  const start = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return;
    setState("starting");
    setMessage(null);
    const result = await bridge.restfoxStart();
    if (!result.ok || !result.url) {
      setState("error");
      setMessage(result.error ?? "Could not start Restfox");
      return;
    }
    await show(result.url);
  }, [show]);

  useEffect(() => {
    void check();
  }, [check]);

  // The native view sits above the DOM, so hide it while a dialog is open.
  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge) return;
    const visible = state === "ready" && !obscured;
    bridge.viewSetVisible(VIEW_ID, visible);
    if (visible) requestAnimationFrame(syncBounds);
  }, [state, obscured, syncBounds]);

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

  if (state === "ready") {
    return (
      <div className="cg-restfox">
        <div className="cg-restfox-bar">
          <span className="cg-view-sub">
            Collections · environments · history · sockets
          </span>
          <span className="cg-toolbar-spacer" />
          <button
            type="button"
            className="cg-icon-btn"
            aria-label="Reload Restfox"
            title="Reload"
            onClick={() => window.contextgit?.viewReload(VIEW_ID)}
          >
            <LuRotateCw aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cg-icon-btn"
            aria-label="Restfox DevTools"
            title="Toggle DevTools"
            onClick={() => window.contextgit?.viewDevtools(VIEW_ID)}
          >
            <LuBug aria-hidden="true" />
          </button>
        </div>
        <div className="cg-restfox-host" ref={hostRef} />
      </div>
    );
  }

  return (
    <div className="cg-restfox-start">
      <h2>Embedded Restfox</h2>
      <p className="cg-empty-note">
        A full API client — collections, folders, environments, code generation,
        history and socket testing — inside the workspace.
      </p>
      {message && (
        <p className="cg-api-error" role="alert">
          {message}
        </p>
      )}
      <button
        type="button"
        className="cg-btn"
        data-variant="primary"
        disabled={!available || state === "starting" || state === "checking"}
        onClick={() => void start()}
      >
        {state === "starting" ? "Starting…" : "Start Restfox"}
      </button>
    </div>
  );
}
