import { useState } from "react";
import { LuPlay, LuTerminal, LuBraces, LuCircleCheck } from "react-icons/lu";
import type { PlaygroundState } from "./usePlayground";
import type { PlaygroundTryResult } from "../../../shared/playground";

export default function TryPane({ state }: { state: PlaygroundState }) {
  const item = state.active;
  const example = (name: string) => JSON.stringify(item?.tryExamples?.[name] ?? {}, null, 2).replaceAll("{project}", state.projectPath ?? "");
  const [tool, setTool] = useState(item?.tryTools?.[0] ?? "");
  const [args, setArgs] = useState(() => example(item?.tryTools?.[0] ?? ""));
  const [result, setResult] = useState<PlaygroundTryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  if (!item?.tryTools?.length) return null;
  const run = async () => {
    if (!state.bridge) return;
    setRunning(true); setError(null); setResult(null);
    try {
      const input: unknown = JSON.parse(args);
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Arguments must be a JSON object.");
      setResult(await state.bridge.playgroundTry(item.id, tool, input as Record<string, unknown>));
    } catch (cause) { setError(String(cause)); }
    finally { setRunning(false); }
  };
  const isMcp = item.kind === "mcp";
  return <section className="cg-pg-try" aria-label="Try tool">
    <div className="cg-pg-result-head"><h2><LuTerminal aria-hidden="true" /> Try it</h2><span>{isMcp ? "READ TOOLS ONLY" : "LOCAL DIAGNOSTIC"}</span></div>
    <p className="cg-view-sub">{isMcp ? "Inspect a real tool call. Read the request and response without adding them to a conversation." : "Check the local installation with a bounded diagnostic."}</p>
    {item.tryNote && <p className="cg-pg-notice">{item.tryNote}</p>}
    <div className="cg-pg-try-controls"><label>Tool<select aria-label="Playground tool" value={tool} disabled={running} onChange={(event) => { setTool(event.target.value); setArgs(example(event.target.value)); setResult(null); setError(null); }}>{item.tryTools.map((name) => <option key={name}>{name}</option>)}</select></label>
      <button className="cg-btn" data-variant="primary" disabled={running || state.busy || !state.bridge || !state.isInstalled(item.id)} onClick={() => void run()}><LuPlay aria-hidden="true" /> {running ? "Running…" : "Run tool"}</button>
    </div>
    <div className="cg-pg-inspector-grid"><div>
      {isMcp ? <label><span>JSON arguments</span><textarea aria-label="Tool JSON arguments" spellCheck={false} value={args} onChange={(event) => setArgs(event.target.value)} /></label> : <div className="cg-pg-result"><div className="cg-pg-result-head">Command</div><pre>{item.tryCommand ?? (item.id === "warden" ? "warden doctor" : "modelcheck --help")}</pre></div>}
      {result && <><div className="cg-pg-result-head" style={{ marginTop: "1rem" }}>Request</div><pre>{JSON.stringify(result.request, null, 2)}</pre></>}
    </div><div className="cg-pg-result"><div className="cg-pg-result-head"><strong>Response</strong>{result && <span><LuCircleCheck aria-hidden="true" /> Received</span>}</div>
      {result ? <pre data-testid="playground-response">{JSON.stringify(result.response, null, 2)}</pre> : <div className="cg-pg-result-empty"><LuBraces aria-hidden="true" /><span>{running ? "Waiting for the tool…" : "Run a tool to inspect its response"}</span></div>}
    </div></div>
    {error && <p className="cg-pg-notice" role="alert">{error}</p>}
    {!state.isInstalled(item.id) && <p className="cg-pg-notice">Install this item in the current project to try it.</p>}
    <p className="cg-view-sub">20 second timeout · {isMcp ? "256 KB" : "64 KB"} output limit</p>
  </section>;
}
