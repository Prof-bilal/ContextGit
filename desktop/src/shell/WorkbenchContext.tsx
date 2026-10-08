import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { TabId } from "./TopNav";
import type { useWorkbenchState } from "./useWorkbenchState";

export type WorkbenchSlots = {
  rail: HTMLElement | null;
  dock: HTMLElement | null;
  footer: HTMLElement | null;
  dialogs: HTMLElement | null;
  views: Partial<Record<TabId, HTMLElement | null>>;
};
export type WorkbenchContextValue = ReturnType<typeof useWorkbenchState> & {
  tab: TabId;
  setTab: Dispatch<SetStateAction<TabId>>;
  theme: "dark" | "light";
  dockOpen: boolean;
  backendAvailable: boolean;
  overlayOpen: boolean;
  setFeatureOverlay: (id: TabId, open: boolean) => void;
  slots: WorkbenchSlots;
};
export const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);
export function useWorkbench() {
  const value = useContext(WorkbenchContext);
  if (!value) throw new Error("Workbench context is missing");
  return value;
}
