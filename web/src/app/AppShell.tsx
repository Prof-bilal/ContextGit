/** The web app frame: icon rail, sessions drawer, and the routed main view. */
import SpatialShell from "../shell/spatial/SpatialShell";
import { useApp } from "./context";
import LeftRail from "./rail/LeftRail";
import SessionsDrawer from "./rail/SessionsDrawer";
import Home from "./home/Home";
import SessionView from "./session/SessionView";
import SkillsPage from "./library/SkillsPage";
import MemoryPage from "./library/MemoryPage";
import SettingsPage from "./library/SettingsPage";
import { EmptyState, Button } from "./ui";
import CommandPalette from "./CommandPalette";
import "./tokens.css";

export default function AppShell({ backendAvailable }: { backendAvailable: boolean }) {
  const { view, wb, go } = useApp();

  let main;
  switch (view.kind) {
    case "session": {
      const session = wb.sessions.find(item => item.id === view.sessionId);
      main = session
        ? <SessionView key={session.id} session={session} />
        : wb.sessionsLoaded
          ? <EmptyState title="Session not found" action={<Button onClick={() => go({ kind: "home" })}>Back to home</Button>}>It may have been closed or belongs to another project.</EmptyState>
          : <EmptyState title="Loading session…" />;
      break;
    }
    case "canvas": main = <div className="app-canvas"><SpatialShell backendAvailable={backendAvailable} /></div>; break;
    case "skills": main = <SkillsPage />; break;
    case "memory": main = <MemoryPage />; break;
    case "settings": main = <SettingsPage />; break;
    default: main = <Home />;
  }

  return (
    <div className="app-root">
      <LeftRail backendAvailable={backendAvailable} />
      <main className="app-main">
        <SessionsDrawer />
        {main}
      </main>
      <CommandPalette />
    </div>
  );
}
