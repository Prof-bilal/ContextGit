import { useEffect, useRef } from "react";
import type { PlaygroundState } from "./usePlayground";

export default function InstallPreview({ state }: { state: PlaygroundState }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const preview = state.preview;
  if (!preview) return null;
  return <dialog ref={dialog} className="cg-pg-dialog" aria-labelledby="cg-pg-preview-title" onCancel={(event) => { if (state.busy) event.preventDefault(); else state.setPreview(null); }}>
    <h2 id="cg-pg-preview-title">Review installation</h2>
    <p className="cg-view-sub">{preview.projectPath}</p>
    <div className="cg-pg-verdict" data-blocked={preview.verdict.status === "blocked"}>
      <strong>{preview.verdict.status === "blocked" ? "Blocked" : "Review required"}</strong>
      <ul>{preview.verdict.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>
    </div>
    {preview.commands.map((command, index) => <section key={index}><h3>Install command (no shell)</h3><pre>{command.map((arg) => JSON.stringify(arg)).join(" ")}</pre></section>)}
    {preview.files.map((file) => <section key={file.path}><h3>{file.path}</h3>
      <div className="cg-pg-diff"><div><h4>Before{file.path.endsWith(".mcp.json") ? " (this entry)" : ""}</h4><pre>{file.before || "File does not exist"}</pre></div><div><h4>After{file.path.endsWith(".mcp.json") ? " (this entry)" : ""}</h4><pre>{file.after}</pre></div></div>
    </section>)}
    {preview.effects.length > 0 && <ul>{preview.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul>}
    <p>Existing MCP entries are preserved. No credential values are saved by Playground.</p>
    {state.progress?.id === preview.itemId && <p role="status">{state.progress.error ?? state.progress.line}</p>}
    <div className="cg-pg-actions"><button className="cg-btn" disabled={state.busy} onClick={() => state.setPreview(null)}>Close</button>
      <button className="cg-btn" data-variant="primary" disabled={state.busy || preview.verdict.status === "blocked"} onClick={() => void state.install()}>{state.busy ? "Installing…" : "Confirm install"}</button>
      {state.busy && <button className="cg-btn" onClick={() => void state.bridge?.playgroundCancel(preview.itemId)}>Cancel install</button>}
    </div>
  </dialog>;
}
