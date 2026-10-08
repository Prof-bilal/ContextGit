import { LuArrowUpRight, LuCheck } from "react-icons/lu";
import type { PlaygroundState } from "./usePlayground";
import ItemMark from "./ItemMark";

export default function FeaturedTools({ state }: { state: PlaygroundState }) {
  if (state.category !== "featured") return null;
  return <div className="cg-pg-featured">{state.items.map((item) => <button key={item.id} className="cg-pg-feature-card" aria-pressed={state.active?.id === item.id} onClick={() => state.select(item.id)}>
    <span className="cg-pg-feature-top"><ItemMark item={item} /><span className="cg-pg-card-kind">{item.kind === "mcp" ? "MCP SERVER" : "DEVELOPER TOOL"}</span><LuArrowUpRight aria-hidden="true" /></span>
    <strong>{item.label}</strong><span className="cg-pg-feature-summary">{item.summary}</span>
    <span className="cg-pg-feature-foot">{state.isInstalled(item.id) ? <><LuCheck aria-hidden="true" /> Installed</> : <>{item.capabilities[0]} <span>Explore →</span></>}</span>
  </button>)}</div>;
}
