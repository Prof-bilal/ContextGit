import { LuCode, LuShield, LuFlaskConical, LuPlug, LuWrench, LuSparkles, LuBlocks } from "react-icons/lu";
import type { PlaygroundItem } from "../../../shared/playground";

export default function ItemMark({ item, small = false }: { item: PlaygroundItem; small?: boolean }) {
  const Icon = item.id === "codeatlas" ? LuCode : item.id === "warden" ? LuShield : item.id === "modelcheck" ? LuFlaskConical
    : item.kind === "mcp" ? LuPlug : item.kind === "skill" ? LuSparkles : item.kind === "plugin" ? LuBlocks : LuWrench;
  return <span className={`cg-pg-mark${small ? " cg-pg-mark-small" : ""}`} data-kind={item.kind} data-item={item.id}><Icon aria-hidden="true" /></span>;
}
