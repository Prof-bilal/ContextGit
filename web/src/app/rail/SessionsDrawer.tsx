/** Sessions drawer next to the rail: switch project, open a running or recent session. */
import { useEffect } from "react";
import type { Session } from "@/shared/api";
import { useApp } from "../context";
import { Button, EmptyState, StatusDot } from "../ui";
import { AgentMark } from "../../shell/primitives";
import "./rail.css";
import { agentLabel, folderName, projectTerminalSessions, relativeTime, STATUS_LABEL } from "./sessionUtils";

export default function SessionsDrawer() {
  const { wb, go, drawerOpen, setDrawerOpen } = useApp();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen) return null;

  // Newest activity first; deleted sessions are left out.
  const sessions = projectTerminalSessions(wb.sessions, wb.activePath);
  const running = sessions.filter(s => s.status === "running");
  const recent = sessions.filter(s => s.status !== "running");

  const projectLabel = wb.activePath ? folderName(wb.activePath) : "No project";

  return (
    <>
      <div
        className="rail-scrim"
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <div
        className="rail-drawer"
        role="dialog"
        aria-label="Sessions"
        aria-modal="true"
        tabIndex={-1}
      >
        <div className="rail-drawer-head">
          <span className="rail-drawer-title">{projectLabel}</span>
          <select
            className="ui-select"
            value={wb.activePath ?? ""}
            onChange={(e) => {
              const path = e.target.value;
              if (path) wb.useProject(path);
            }}
            aria-label="Active project"
          >
            {wb.projects.map(p => (
              <option key={p.path} value={p.path}>{p.name}</option>
            ))}
          </select>
          <Button size="sm" onClick={() => void wb.choose()}>
            Open folder
          </Button>
        </div>
        <div className="rail-drawer-body">
          {sessions.length === 0 ? (
            <EmptyState
              title="No sessions yet"
              action={
                <Button
                  variant="primary"
                  onClick={() => { go({ kind: "home" }); setDrawerOpen(false); }}
                >
                  New session
                </Button>
              }
            >
              Start a session to see it here.
            </EmptyState>
          ) : (
            <div className="rail-drawer-groups">
              {running.length > 0 && (
                <div className="rail-drawer-group">
                  <h3 className="rail-drawer-heading">Running</h3>
                  {running.map(s => (
                    <SessionRow key={s.id} session={s} />
                  ))}
                </div>
              )}
              {recent.length > 0 && (
                <div className="rail-drawer-group">
                  <h3 className="rail-drawer-heading">Recent</h3>
                  {recent.map(s => (
                    <SessionRow key={s.id} session={s} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SessionRow({ session }: { session: Session }) {
  const { go, setDrawerOpen } = useApp();
  return (
    <button
      type="button"
      className="rail-session-row"
      onClick={() => { go({ kind: "session", sessionId: session.id }); setDrawerOpen(false); }}
    >
      <AgentMark agent={session.agent ?? "shell"} label={agentLabel(session.agent)} />
      <span className="rail-session-name" title={session.name}>{session.name}</span>
      <span className="rail-session-time">{relativeTime(session.updated_at || session.created_at)}</span>
      <StatusDot status={session.status} label={STATUS_LABEL[session.status]} />
    </button>
  );
}
