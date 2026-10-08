import { LuSearch, LuSparkles, LuPlug, LuWrench, LuBlocks, LuCheck, LuBookOpen } from "react-icons/lu";
import { PLAYGROUND_ITEMS } from "../../../shared/playground";
import type { PlaygroundCategory, PlaygroundState } from "../playground/usePlayground";
import ItemMark from "../playground/ItemMark";

const CATEGORIES = [
  { id: "featured", label: "Featured", Icon: LuSparkles }, { id: "mcp", label: "MCP servers", Icon: LuPlug },
  { id: "skill", label: "Skills", Icon: LuBookOpen }, { id: "tool", label: "Tools", Icon: LuWrench },
  { id: "plugin", label: "Plugins", Icon: LuBlocks }, { id: "installed", label: "Installed", Icon: LuCheck },
] satisfies { id: PlaygroundCategory; label: string; Icon: typeof LuSearch }[];
export default function PlaygroundRail({ state }: { state: PlaygroundState }) {
  const count = (category: PlaygroundCategory) => PLAYGROUND_ITEMS.filter((item) => category === "featured" ? item.featured : category === "installed" ? state.isInstalled(item.id) : item.kind === category).length;
  return <nav className="cg-rail cg-pg-rail" aria-label="Playground catalog">
    <div className="cg-rail-head"><h2>Playground</h2><span className="cg-count">{PLAYGROUND_ITEMS.length}</span></div>
    <label className="cg-rail-search cg-pg-search"><LuSearch aria-hidden="true" /><input aria-label="Search Playground" placeholder="Find your next tool…" value={state.query} onChange={(event) => state.setQuery(event.target.value)} /></label>
    <div className="cg-pg-categories">{CATEGORIES.map(({ id, label, Icon }) => <button key={id} className="cg-pg-category" aria-pressed={state.category === id} onClick={() => { state.setCategory(id); state.setPreview(null); }}><Icon aria-hidden="true" /><span>{label}</span><small>{count(id)}</small></button>)}</div>
    <label className="cg-pg-trust">Publisher<select aria-label="Filter Playground trust" value={state.trust} onChange={(event) => state.setTrust(event.target.value as PlaygroundState["trust"])}><option value="all">All publishers</option><option value="first-party">ContextGit bundled</option><option value="community">Community</option></select></label>
    <div className="cg-pg-list-heading"><span>{state.category === "installed" ? "YOUR TOOLS" : "IN THIS COLLECTION"}</span><small>{state.items.length}</small></div>
    {state.items.length === 0 && <p className="cg-empty-note">No items match these filters.</p>}
    {state.items.map((item) => <button key={item.id} className="cg-row cg-pg-row" aria-current={state.active?.id === item.id} onClick={() => state.select(item.id)}>
      <ItemMark item={item} small /><span className="cg-pg-row-text"><strong>{item.label}</strong><span>{item.vendor}</span><small>{state.isInstalled(item.id) ? "Installed" : item.install.kind === "docs" ? "Guided setup" : "Local install"}</small></span>
    </button>)}
  </nav>;
}
