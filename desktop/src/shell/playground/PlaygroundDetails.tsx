import { LuShieldCheck, LuArrowUpRight } from "react-icons/lu";
import { Field } from "../primitives";
import type { PlaygroundState } from "./usePlayground";

export default function PlaygroundDetails({ state }: { state: PlaygroundState }) {
  const item = state.active;
  if (!item) return <p className="cg-empty-note">Choose a tool to inspect its access and setup.</p>;
  return <div className="cg-pg-dock"><div className="cg-pg-dock-heading"><LuShieldCheck aria-hidden="true" /><strong>Access & setup</strong></div>
    <div className="cg-fields"><Field label="Publisher">{item.vendor}</Field><Field label="Status">{state.isInstalled(item.id) ? "Installed in this project" : item.install.kind === "docs" ? "Guided setup" : "Ready for review"}</Field>
      <Field label="Files">{item.sandbox ? item.sandbox.projectRead ? "Read this project" : "Package files only" : item.kind === "skill" ? "Adds one skill file" : "See installation preview"}</Field>
      {item.sandbox && <><Field label="Writes">{item.sandbox.writeDirectory ?? "None"}</Field><Field label="Network">{item.sandbox.network?.join(", ") || "Denied"}</Field></>}
    </div>
    <p className="cg-empty-note">{item.install.kind === "docs" ? "Follow the maintainer's setup guide to connect this integration in your MCP client." : item.kind === "mcp" && item.sandbox ? "Warden applies these grants at runtime. Install Warden first and use its diagnostic to check your host." : "Review the installation preview before changing this project's toolkit."}</p>
    <button className="cg-btn" onClick={() => void state.bridge?.playgroundDocs(item.id)}>Maintainer docs <LuArrowUpRight aria-hidden="true" /></button>
  </div>;
}
