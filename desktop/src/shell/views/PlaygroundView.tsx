import { LuArrowDownToLine, LuArrowUpRight, LuCheck, LuFolder, LuShieldCheck, LuTerminal } from "react-icons/lu";
import type { PlaygroundState } from "../playground/usePlayground";
import InstallPreview from "../playground/InstallPreview";
import TryPane from "../playground/TryPane";
import ItemMark from "../playground/ItemMark";
import FeaturedTools from "../playground/FeaturedTools";

export default function PlaygroundView({ state }: { state: PlaygroundState }) {
  const item = state.active;
  const docs = () => { if (item) void state.bridge?.playgroundDocs(item.id); };
  const installed = item ? state.isInstalled(item.id) : false;
  const manual = item?.install.kind === "docs";
  const progress = state.progress?.id === item?.id ? state.progress : null;
  const categoryName = { featured: "Featured", mcp: "MCP servers", skill: "Skills", tool: "Tools", plugin: "Plugins", installed: "Installed" }[state.category];
  return <div className="cg-pg-view"><div className="cg-pg-content">
    <div className="cg-pg-page-head"><div><span className="cg-pg-eyebrow">YOUR DEVELOPMENT TOOLKIT</span><h2>Playground <span>/ {categoryName}</span></h2></div><span className="cg-pg-catalog-status"><span /> Curated catalog</span></div>
    <FeaturedTools state={state} />
    {!item ? <div className="cg-pg-empty"><LuFolder aria-hidden="true" /><h1>{state.category === "installed" ? "Your toolkit starts here" : "No matching tools"}</h1><p>{state.category === "installed" ? "Browse the catalog and install a tool or skill to add it to this project." : "Try a different search or reset the publisher filter."}</p><button className="cg-btn" onClick={() => { state.setQuery(""); state.setTrust("all"); state.setCategory("featured"); }}>Explore featured tools</button></div> : <>
      <div className="cg-pg-detail-grid"><div className="cg-pg-hero">
        <div className="cg-pg-identity"><ItemMark item={item} /><div><span className="cg-pg-eyebrow">{item.kind === "mcp" ? "MCP SERVER" : item.kind.toUpperCase()} · {item.vendor}</span><h1>{item.label}</h1></div></div>
        <p className="cg-pg-summary">{item.summary}</p>
        <div className="cg-pg-badges"><span>{item.trust === "first-party" ? "ContextGit bundled" : "Community publisher"}</span>{installed && <span className="cg-pg-installed"><LuCheck aria-hidden="true" /> Installed in this project</span>}</div>
        <div className="cg-pg-actions">
          {manual ? <button className="cg-btn" data-variant="primary" disabled={!state.bridge} onClick={docs}><LuArrowUpRight aria-hidden="true" /> Setup guide</button>
            : <button className="cg-btn" data-variant="primary" disabled={!state.bridge || !state.projectPath || state.busy} onClick={() => void state.review()}><LuArrowDownToLine aria-hidden="true" />{state.busy ? "Working…" : installed ? "Review installation" : "Install"}</button>}
          {state.bridge ? <button className="cg-btn" onClick={docs}>Documentation <LuArrowUpRight aria-hidden="true" /></button> : <a className="cg-btn" href={item.docsUrl} target="_blank" rel="noreferrer">Documentation ↗</a>}
        </div>
        {!state.projectPath && <p className="cg-pg-notice">Choose a project to install and try tools.</p>}
        {!state.bridge && <p className="cg-pg-notice">Open the desktop app to install and try tools.</p>}
        {state.error && <p className="cg-pg-notice" role="alert">{state.error}</p>}
        {progress && !state.preview && <p className="cg-pg-notice" data-error={progress.phase === "error"} role="status">{progress.error ?? progress.line}</p>}
      </div><aside className="cg-pg-setup-card" aria-label="Installation details">
        <span className="cg-pg-eyebrow">AT A GLANCE</span>
        <div><LuFolder aria-hidden="true" /><span><strong>Project scope</strong><small>{state.projectPath?.split(/[\\/]/).pop() ?? "Choose a workspace"}</small></span></div>
        <div><LuTerminal aria-hidden="true" /><span><strong>{manual ? "Guided setup" : item.install.kind === "npm" ? "Isolated local package" : item.kind === "skill" ? "Workspace skill" : "MCP configuration"}</strong><small>{item.install.kind === "npm" ? `Version ${item.install.version}` : manual ? "Connect through your MCP client" : "No package download"}</small></span></div>
        <div><LuShieldCheck aria-hidden="true" /><span><strong>{manual ? "Review provider permissions" : "Review before installing"}</strong><small>{manual ? "Authentication stays with the provider" : "See all commands and config changes"}</small></span></div>
      </aside></div>
      <section className="cg-pg-capabilities"><h2>What it adds</h2><div className="cg-pg-badges">{item.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div></section>
      {manual && <section className="cg-pg-guided"><h2>Connect this integration</h2><p>{item.install.kind === "docs" ? item.install.reason : ""}</p>{item.setup && <ol>{item.setup.map((step) => <li key={step}>{step.startsWith("claude ") ? <code>{step}</code> : step}</li>)}</ol>}<button className="cg-btn" onClick={docs}>Open setup guide <LuArrowUpRight aria-hidden="true" /></button></section>}
      <TryPane key={`${state.projectPath}:${item.id}`} state={state} />
    </>}
    {state.preview && <InstallPreview state={state} />}
  </div></div>;
}
