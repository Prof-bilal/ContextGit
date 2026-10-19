import { WorkbenchResources } from "./WorkbenchResources";
import SpatialShell from "./spatial/SpatialShell";
import { useEffect } from 'react';

/**
 * The spatial canvas is now the only mounted product surface. The legacy Git,
 * editor, browser, and tab implementations remain in the tree for one release,
 * but are deliberately not imported or mounted here.
 */
export default function Shell(props: { backendAvailable?: boolean }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('tab')) { url.searchParams.delete('tab'); window.history.replaceState(null, '', url); }
  }, []);
  return <WorkbenchResources><SpatialShell {...props} /></WorkbenchResources>;
}
