import { WorkbenchResources } from "./WorkbenchResources";
import { AppProvider } from "../app/context";
import AppShell from "../app/AppShell";
import { useEffect } from 'react';

/**
 * The web app frame (rail, home, sessions, workspace) lives in `src/app`; the
 * spatial canvas is one of its views. See docs/web-ui-plan.md.
 */
export default function Shell(props: { backendAvailable?: boolean }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('tab')) { url.searchParams.delete('tab'); window.history.replaceState(null, '', url); }
  }, []);
  return <WorkbenchResources><AppProvider><AppShell backendAvailable={props.backendAvailable ?? true} /></AppProvider></WorkbenchResources>;
}
