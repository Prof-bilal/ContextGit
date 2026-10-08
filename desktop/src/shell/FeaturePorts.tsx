import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TabId } from "./TopNav";
import { FeatureRegion } from "./FeatureBoundary";
import { useWorkbench } from "./WorkbenchContext";

/** Stable DOM hosts belong to the shell; controllers own only their feature's content. */
export function FeaturePorts({ id, title, rail, view, dock, footer, dialogs, onDismissDialogs, hasModal = false, notice }: {
  id: TabId; title: string;
  rail?: () => ReactNode; view?: () => ReactNode; dock?: () => ReactNode;
  footer?: () => ReactNode; dialogs?: () => ReactNode;
  hasModal?: boolean; notice?: string | null;
  onDismissDialogs?: () => void;
}) {
  const { tab, slots, dockOpen, setFeatureOverlay } = useWorkbench();
  const active = tab === id;
  const live = id === "code" || id === "browser" || id === "editor";
  useEffect(() => {
    setFeatureOverlay(id, hasModal);
    return () => setFeatureOverlay(id, false);
  }, [id, hasModal, setFeatureOverlay]);
  const portal = (region: string, target: HTMLElement | null | undefined, render?: () => ReactNode) => target && render
    ? createPortal(<FeatureRegion feature={`${title} ${region}`} render={render} />, target, region)
    : null;
  return <>
    {active && portal("rail", slots.rail, rail)}
    {(active || live) && slots.views[id] && createPortal(<>
      {notice && <p className="cg-banner" role="alert">{notice}</p>}
      <FeatureRegion feature={`${title} content`} render={view ?? (() => null)} />
    </>, slots.views[id]!, "view")}
    {active && dockOpen && portal("inspector", slots.dock, dock)}
    {active && portal("actions", slots.footer, footer)}
    {hasModal && slots.dialogs && dialogs && createPortal(
      <FeatureRegion feature={`${title} dialogs`} render={dialogs} onDismiss={onDismissDialogs} />,
      slots.dialogs, "dialogs")}
  </>;
}
