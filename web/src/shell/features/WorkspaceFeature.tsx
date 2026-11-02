import { createPortal } from "react-dom";
import { useRef } from "react";
import { useWorkbench } from "../WorkbenchContext";
import WorkspaceWorkbench from "../workspace/WorkspaceWorkbench";

function WorkspaceFeature({ mode }: { mode: "editor" | "browser" }) {
  const { workspace, tab, slots, overlayOpen } = useWorkbench();
  const visited = useRef(false);
  const lastWorkspace = useRef(workspace);
  const active = tab === mode;
  if (active) { visited.current = true; lastWorkspace.current = workspace; }
  // Feature controllers are kept mounted by the shell for error isolation,
  // but their workbench surface must not render into an inactive portal. A
  // Browser panels are positioned by normal document layout, so CSS hiding
  // the parent is not sufficient; it can otherwise leak into the Code tab.
  const target = slots.views[mode];
  if (!visited.current || !target) return null;
  return createPortal(<WorkspaceWorkbench workspace={lastWorkspace.current} mode={mode} active={active && !overlayOpen} />, target);
}

export function EditorFeature() { return <WorkspaceFeature mode="editor" />; }
export function BrowserFeature() { return <WorkspaceFeature mode="browser" />; }
