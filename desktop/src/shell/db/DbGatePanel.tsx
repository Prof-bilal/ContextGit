import { useCallback, useEffect, useRef, useState } from "react";
import { LuBug, LuRotateCw } from "react-icons/lu";

const VIEW_ID = "dbgate";

type State = "checking" | "absent" | "starting" | "ready" | "error";

/**
 * The DB tab's embedded client: DbGate — a `dbgate-serve` sidecar shown through
 * the shared `WebContentsView` primitive, exactly like the Editor tab's VS Code.
 * Started on demand; until then it shows a start card.
 */
export default function DbGatePanel({ obscured }: { obscured: boolean }) {
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
          setMessage(created.error ?? "Could not open DbGate");
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
    const status = await bridge.dbgateStatus();
    setAvailable(status.available);
    if (status.running && status.url) {
      await show(status.url);
      return;
    }
    setState("absent");
    if (!status.available) {
      setMessage("DbGate is not installed. Run `npm run fetch:dbgate` in desktop/.");
    }
  }, [show]);

  const start = useCallback(async () => {
    const bridge = window.contextgit;
    if (!bridge) return;
    setState("starting");
    setMessage(null);
    const result = await bridge.dbgateStart();
    if (!result.ok || !result.url) {
      setState("error");
      setMessage(result.error ?? "Could not start DbGate");
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
      <div className="cg-dbgate">
        <div className="cg-dbgate-bar">
          <span className="cg-view-sub">
            MySQL · Postgres · SQL Server · MongoDB · Redis · SQLite · ClickHouse
          </span>
          <span className="cg-toolbar-spacer" />
          <button
            type="button"
            className="cg-icon-btn"
            aria-label="Reload DbGate"
            title="Reload"
            onClick={() => window.contextgit?.viewReload(VIEW_ID)}
          >
            <LuRotateCw aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cg-icon-btn"
            aria-label="DbGate DevTools"
            title="Toggle DevTools"
            onClick={() => window.contextgit?.viewDevtools(VIEW_ID)}
          >
            <LuBug aria-hidden="true" />
          </button>
        </div>
        <div className="cg-dbgate-host" ref={hostRef} />
      </div>
    );
  }

  return (
    <div className="cg-dbgate-start">
      <h2>Embedded DbGate</h2>
      <p className="cg-empty-note">
        A full database client — browse schemas, edit data and run queries against
        MySQL, Postgres, SQL Server, MongoDB, Redis, SQLite and more — inside the
        workspace.
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
        {state === "starting" ? "Starting…" : "Start DbGate"}
      </button>
    </div>
  );
}
