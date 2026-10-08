import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import TopNav, { type TabId } from "../src/shell/TopNav";
import { FeatureBoundary } from "../src/shell/FeatureBoundary";
import { FeaturePorts } from "../src/shell/FeaturePorts";
import { WorkbenchContext, type WorkbenchContextValue, type WorkbenchSlots } from "../src/shell/WorkbenchContext";
import { createIsolatedResource } from "../src/shell/isolatedResource";
import { useFeatureAction } from "../src/shell/useFeatureAction";
import { useBackendPolling } from "../src/shell/useBackendPolling";
import "../src/shell.css";

type Fault = { id: TabId; region: string } | null;
declare global {
  interface Window {
    isolation: { fault: (fault: Fault) => void; resourceCrash: (crash: boolean) => void; terminalMounts: number };
  }
}
let failResource = false;
let refreshResource = () => { };
window.contextgit = {
  getStatus: () => ({ status: { state: "ready" }, apiBase: "http://localhost" }),
  onStatus: () => () => { },
} as unknown as NonNullable<Window["contextgit"]>;
window.isolation = { fault: () => { }, resourceCrash: crash => { failResource = crash; refreshResource(); }, terminalMounts: 0 };

const useResource = createIsolatedResource("Test resource", function useTestResource() {
  const [, rerender] = useState(0);
  refreshResource = () => rerender(value => value + 1);
  const [count, setCount] = useState(7);
  if (failResource) throw new Error("resource hook failed");
  return { error: null as string | null, count, increment: async () => { setCount(value => value + 1); } };
}, { error: null as string | null, count: 0, increment: async () => { throw new Error("resource unavailable"); } });

function LiveTerminal({ name }: { name: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => { window.isolation.terminalMounts++; }, []);
  return <button onClick={() => setCount(value => value + 1)}>{name}: {count}</button>;
}

function Controller({ id, fault }: { id: "api" | "code"; fault: Fault }) {
  const [draft, setDraft] = useState("");
  const [modal, setModal] = useState(false);
  const { error, run } = useFeatureAction();
  const task = useCallback(async () => {
    if (fault?.id === id && fault.region === "background") throw new Error("background task failed");
  }, [fault, id]);
  useBackendPolling(task, 100);
  if (fault?.id === id && fault.region === "hook") throw new Error("feature hook failed");
  const region = (name: string, children: ReactNode) => () => {
    if (fault?.id === id && fault.region === name) throw new Error(`${name} render failed`);
    return children;
  };
  return <FeaturePorts id={id} title={id} notice={error} hasModal={modal} onDismissDialogs={() => setModal(false)}
    rail={region("rail", <nav className="cg-rail">{id} rail</nav>)}
    view={region("content", <>
      <label>{id} draft<input aria-label={`${id} draft`} value={draft} onChange={event => setDraft(event.target.value)} /></label>
      <button onClick={() => setModal(true)}>Open {id} dialog</button>
      <button onClick={() => void run(() => { throw new Error("action failed locally"); })}>Fail {id} action</button>
    </>)}
    dock={region("inspector", <div>{id} inspector</div>)}
    footer={region("actions", <footer>{id} actions</footer>)}
    dialogs={modal ? region("dialogs", <section role="dialog">{id} dialog<button onClick={() => setModal(false)}>Close {id} dialog</button></section>) : undefined}
  />;
}

function Harness() {
  const [tab, setTab] = useState<TabId>("api");
  const [fault, setFault] = useState<Fault>(null);
  window.isolation.fault = setFault;
  const resource = useResource();
  const action = useFeatureAction();
  const [overlays, setOverlays] = useState<Partial<Record<TabId, boolean>>>({});
  const setFeatureOverlay = useCallback((id: TabId, open: boolean) => {
    setOverlays(current => current[id] === open ? current : { ...current, [id]: open });
  }, []);
  const [slots, setSlots] = useState<WorkbenchSlots>({ rail: null, dock: null, footer: null, dialogs: null, views: {} });
  const [refs] = useState(() => {
    const region = (key: "rail" | "dock" | "footer" | "dialogs") => (node: HTMLDivElement | null) => setSlots(value => ({ ...value, [key]: node }));
    return {
      rail: region("rail"), dock: region("dock"), footer: region("footer"), dialogs: region("dialogs"),
      api: (node: HTMLDivElement | null) => setSlots(value => ({ ...value, views: { ...value.views, api: node } })),
      code: (node: HTMLDivElement | null) => setSlots(value => ({ ...value, views: { ...value.views, code: node } }))
    };
  });
  const context = { tab, setTab, slots, dockOpen: true, setFeatureOverlay } as unknown as WorkbenchContextValue;
  return <WorkbenchContext.Provider value={context}>
    <div className="cg-shell">
      <TopNav tabs={[{ id: "api", label: "API" }, { id: "code", label: "Code" }]} active={tab} onChange={setTab} />
      <div className="cg-body">
        <div className="cg-slot" ref={refs.rail} />
        <main className="cg-main">
          <div className="cg-view" data-active={tab === "api"}><div className="cg-feature-content" ref={refs.api} /></div>
          <div className="cg-view" data-active={tab === "code"}>
            <div className="cg-slot" ref={refs.code} />
            <LiveTerminal name="terminal one" /><LiveTerminal name="terminal two" />
          </div>
        </main>
        <div ref={refs.dock} />
      </div>
      <div className="cg-slot" ref={refs.footer} /><div className="cg-slot" ref={refs.dialogs} />
      <FeatureBoundary feature="API" target={slots.views.api ?? null}><Controller id="api" fault={fault} /></FeatureBoundary>
      <FeatureBoundary feature="Code" target={slots.views.code ?? null}><Controller id="code" fault={fault} /></FeatureBoundary>
    </div>
    <aside>
      <span data-testid="overlay">{Object.values(overlays).some(Boolean) ? "obscured" : "visible"}</span>
      <span data-testid="resource">data: {resource.value.count}</span>
      <button onClick={() => void action.run(resource.value.increment)}>Increment resource</button>
      {action.error && <p role="alert">{action.error}</p>}
      {resource.host}
    </aside>
  </WorkbenchContext.Provider>;
}

createRoot(document.getElementById("root")!).render(<Harness />);
