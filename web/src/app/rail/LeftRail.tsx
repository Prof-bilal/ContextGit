/** Narrow icon rail: home, new session, sessions drawer, the main views, settings, backend status. */
import { LuBrain, LuMessagesSquare, LuPlus, LuSettings, LuSparkles, LuWorkflow } from "react-icons/lu";
import { useApp } from "../context";
import { IconButton } from "../ui";
import { requestPromptFocus } from "./sessionUtils";
import "./rail.css";

export default function LeftRail({ backendAvailable }: { backendAvailable: boolean }) {
  const { wb, view, go, drawerOpen, setDrawerOpen } = useApp();
  const running = wb.sessions.filter(session => session.kind === "terminal" && session.status === "running" && !session.deleted_at).length;

  const open = (kind: "canvas" | "skills" | "memory" | "settings") => {
    setDrawerOpen(false);
    go({ kind });
  };

  return (
    <nav className="app-rail rail" aria-label="Main">
      <button type="button" className="rail-logo" aria-label="Home" title="Home"
        onClick={() => { setDrawerOpen(false); go({ kind: "home" }); }}>
        CG
      </button>
      <IconButton label="New session" icon={<LuPlus />} current={view.kind === "home"}
        onClick={() => { setDrawerOpen(false); go({ kind: "home" }); requestPromptFocus(); }} />
      <IconButton
        label={running ? `Sessions (${running} running)` : "Sessions"}
        icon={<><LuMessagesSquare />{running > 0 && <span className="rail-badge" aria-hidden="true">{running}</span>}</>}
        active={drawerOpen}
        current={view.kind === "session"}
        onClick={() => setDrawerOpen(!drawerOpen)}
      />
      <span className="rail-sep" aria-hidden="true" />
      <IconButton label="Canvas" icon={<LuWorkflow />} current={view.kind === "canvas"} onClick={() => open("canvas")} />
      <IconButton label="Skills" icon={<LuSparkles />} current={view.kind === "skills"} onClick={() => open("skills")} />
      <IconButton label="Memory" icon={<LuBrain />} current={view.kind === "memory"} onClick={() => open("memory")} />
      <span className="rail-spacer" />
      <IconButton label="Settings" icon={<LuSettings />} current={view.kind === "settings"} onClick={() => open("settings")} />
      <span
        className={`rail-status ${backendAvailable ? "rail-status--ok" : "rail-status--down"}`}
        role="img"
        aria-label={backendAvailable ? "Backend connected" : "Backend unreachable"}
        title={backendAvailable ? "Backend connected" : "Backend unreachable"}
      />
    </nav>
  );
}
