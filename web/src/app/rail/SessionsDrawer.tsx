import { useEffect } from "react";
import { useApp } from "../context";
import { Button, EmptyState, StatusDot } from "../ui";
import { AgentMark } from "../../shell/primitives";
import "./rail.css";
import { relativeTime, folderName } from "./sessionUtils";

export default function SessionsDrawer() {
  const { wb, view, go, drawerOpen, setDrawerOpen } = useApp();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen) return null;

  const sessions = wb.sessions.filter(
    s => s.kind === "terminal" && (!wb.activePath || s.project_path === wb.activePath)
  );

  const running = sessions.filter(s => s.status === "running");
  const recent = sessions
    .filter(s => s.status !== "running")
    .sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at));

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
          <Button
            className="ui-btn--sm"
            onClick={() => wb.choose()}
          >
            Open folder
          </Button>
        </div>
        <div className="rail-drawer-body">
          {sessions.length === 0 ? (
            <EmptyState
              title="No sessions yet"
              action={
                <Button
                  className="ui-btn--primary"
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

function SessionRow({ session }: { session: { id: string; name: string; status: string; agent: string | null; created_at: string } }) {
  const { go, setDrawerOpen } = useApp();
  return (
    <button
      type="button"
      className="rail-session-row"
      onClick={() => { go({ kind: "session", sessionId: session.id }); setDrawerOpen(false); }}
    >
      <AgentMark agent={session.agent ?? "shell"} label={session.agent ?? "shell"} />
      <span className="rail-session-name">{session.name}</span>
      <span className="rail-session-time">{relativeTime(session.created_at)}</span>
      <StatusDot status={session.status as any} />
    </button>
  );
}

function timeOf(iso: string): number {
  const value = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(value) ? 0 : value;
}