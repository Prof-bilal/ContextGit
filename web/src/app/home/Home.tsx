/** "What do you want to build?" start screen: pick a project, agent and run location, then start. */
import { useEffect, useRef, useState } from "react";
import { LuFolderOpen } from "react-icons/lu";
import { DEFAULT_HARNESS, HARNESSES } from "@/shared/harnesses";
import { projectApi } from "@/shared/api";
import { terminalRuntime } from "../../shell/terminal/runtime";
import { agentLabel, folderName, FOCUS_PROMPT_EVENT, projectTerminalSessions, relativeTime, STATUS_LABEL } from "../rail/sessionUtils";
import { useApp } from "../context";
import { Button, Card, Chip, StatusDot } from "../ui";
import "./home.css";

type RunLocation = "root" | "worktree";
type LastRun = { agent?: unknown; location?: unknown };

const lastRunKey = (path: string) => `contextgit:last-run:${path}`;

export default function Home() {
  const { wb, go } = useApp();
  const [agent, setAgent] = useState(DEFAULT_HARNESS);
  const [location, setLocation] = useState<RunLocation>("root");
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // The rail's "New session" button asks for the prompt to be focused.
  useEffect(() => {
    const focus = () => promptRef.current?.focus();
    window.addEventListener(FOCUS_PROMPT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_PROMPT_EVENT, focus);
  }, []);

  const projectPath = wb.activePath;
  const shell = HARNESSES.find(harness => harness.id === "shell");
  const clis = shell ? [shell, ...HARNESSES.filter(harness => harness.id !== "shell")] : HARNESSES;
  const recent = projectPath ? projectTerminalSessions(wb.sessions, projectPath).slice(0, 6) : [];

  // Preselect the CLI and run location this project used last.
  useEffect(() => {
    if (!projectPath) return;
    let saved: LastRun = {};
    try {
      saved = JSON.parse(localStorage.getItem(lastRunKey(projectPath)) ?? "{}") as LastRun;
    } catch {
      saved = {};
    }
    setAgent(typeof saved.agent === "string" && HARNESSES.some(harness => harness.id === saved.agent)
      ? saved.agent
      : DEFAULT_HARNESS);
    setLocation(saved.location === "worktree" ? "worktree" : "root");
  }, [projectPath]);

  const openFolder = async () => {
    try {
      setError(null);
      await wb.choose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open a project folder");
    }
  };

  const start = async () => {
    if (!projectPath || starting) return;
    setStarting(true);
    setError(null);
    const text = prompt.trim();
    try {
      const session = await projectApi(projectPath).createSession({
        name: text ? text.split("\n")[0].slice(0, 60) : agentLabel(agent),
        kind: "terminal",
        agent,
        projectPath,
        worktree: location === "worktree",
        baseRef: location === "worktree" ? "HEAD" : undefined,
        task: text || undefined,
      });
      wb.addSession(session);
      await terminalRuntime.ensure(session);
      const launch = terminalRuntime.snapshot(session.id);
      if (launch.state === "error") throw new Error(launch.error ?? "Agent launch failed");
      localStorage.setItem(lastRunKey(projectPath), JSON.stringify({ agent, location }));
      await wb.refresh();
      go({ kind: "session", sessionId: session.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the session");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="home app-scroll">
      <header className="home-intro">
        <h1>What do you want to build?</h1>
        <p>Pick an agent, describe the task, and ContextGit will record every step.</p>
      </header>

      <Card className="home-card">
        {projectPath ? (
          <div className="home-project">
            <Chip icon={<LuFolderOpen aria-hidden="true" />} title={projectPath}>{folderName(projectPath)}</Chip>
            <Button icon={<LuFolderOpen aria-hidden="true" />} onClick={() => void openFolder()} disabled={starting}>
              Open folder
            </Button>
          </div>
        ) : (
          <div className="home-project home-project-empty">
            <Button variant="primary" size="lg" icon={<LuFolderOpen aria-hidden="true" />}
              onClick={() => void openFolder()} disabled={starting}>
              Open a project folder
            </Button>
            <p>Choose a folder to keep its sessions and history together.</p>
          </div>
        )}

        <div className="home-field">
          <span className="home-label" id="home-agent-label">Agent</span>
          <div className={projectPath ? "home-chips" : "home-chips home-chips--disabled"} role="group" aria-labelledby="home-agent-label">
            {clis.map(harness => (
              <Chip key={harness.id} pressed={agent === harness.id}
                onClick={projectPath && !starting ? () => setAgent(harness.id) : undefined}>
                {harness.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="home-field">
          <span className="home-label" id="home-location-label">Run location</span>
          <div className={projectPath ? "home-chips" : "home-chips home-chips--disabled"} role="group" aria-labelledby="home-location-label">
            <Chip pressed={location === "root"}
              onClick={projectPath && !starting ? () => setLocation("root") : undefined}>
              Project root
            </Chip>
            <Chip pressed={location === "worktree"}
              onClick={projectPath && !starting ? () => setLocation("worktree") : undefined}>
              New worktree
            </Chip>
          </div>
        </div>

        <textarea
          ref={promptRef}
          className="ui-textarea"
          aria-label="Describe the task"
          placeholder="Describe the task…"
          value={prompt}
          disabled={!projectPath || starting}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void start();
            }
          }}
        />

        <div className="home-footer">
          <span className="home-footer-hint">Ctrl+Enter to start</span>
          <Button variant="primary" onClick={() => void start()} disabled={!projectPath || starting}>
            {starting ? "Starting…" : "Start"}
          </Button>
        </div>

        {error && <p className="ui-error home-error" role="alert">{error}</p>}
      </Card>

      {recent.length > 0 && (
        <section className="home-recent-section" aria-labelledby="home-recent-heading">
          <h2 id="home-recent-heading">Recent sessions</h2>
          <div className="home-recent-grid">
            {recent.map(session => (
              <Card key={session.id} className="home-recent-card">
                <button type="button" className="home-recent"
                  onClick={() => go({ kind: "session", sessionId: session.id })}>
                  <span className="home-recent-top">
                    <span className="home-recent-agent">{agentLabel(session.agent)}</span>
                    <StatusDot status={session.status} label={STATUS_LABEL[session.status]} />
                  </span>
                  <span className="home-recent-name" title={session.name}>{session.name}</span>
                  <span className="home-recent-meta">
                    {STATUS_LABEL[session.status]} · {relativeTime(session.updated_at || session.created_at)}
                  </span>
                </button>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
