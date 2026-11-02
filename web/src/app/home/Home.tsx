/** Start a run: a command line for the open project, then recent runs as a git-log lane. */
import { useEffect, useRef, useState } from "react";
import { LuCornerDownLeft, LuFolderOpen } from "react-icons/lu";
import { DEFAULT_HARNESS, HARNESSES } from "@/shared/harnesses";
import { projectApi } from "@/shared/api";
import { terminalRuntime } from "../../shell/terminal/runtime";
import { agentLabel, FOCUS_PROMPT_EVENT, projectTerminalSessions, relativeTime, STATUS_LABEL } from "../rail/sessionUtils";
import { useApp } from "../context";
import { Button, Chip } from "../ui";
import "./home.css";

type RunLocation = "root" | "worktree";
type LastRun = { agent?: unknown; location?: unknown };

const lastRunKey = (path: string) => `contextgit:last-run:${path}`;

/** "C:\Users\me\code\app" -> "~\code\app": the path the way a prompt shows it. */
function promptPath(path: string): string {
  const home = path.match(/^([A-Za-z]:[\\/]Users[\\/][^\\/]+|\/(?:home|Users)\/[^/]+)/)?.[1];
  return home ? `~${path.slice(home.length)}` : path;
}

export default function Home() {
  const { wb, go } = useApp();
  const [agent, setAgent] = useState(DEFAULT_HARNESS);
  const [location, setLocation] = useState<RunLocation>("root");
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Agent CLIs found on PATH; null until checked. Shell is always available.
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const projectPath = wb.activePath;
  const recent = projectPath ? projectTerminalSessions(wb.sessions, projectPath).slice(0, 8) : [];

  // The rail's "New session" button asks for the prompt to be focused.
  useEffect(() => {
    const focus = () => promptRef.current?.focus();
    window.addEventListener(FOCUS_PROMPT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_PROMPT_EVENT, focus);
  }, []);

  useEffect(() => {
    const bridge = window.contextgit;
    if (!bridge) return;
    let alive = true;
    void Promise.all(HARNESSES.map(harness =>
      harness.id === "shell"
        ? Promise.resolve(harness.id)
        : bridge.harnessCheck(harness.id).then(result => (result.installed ? harness.id : null), () => null),
    )).then(ids => { if (alive) setInstalled(new Set(ids.filter((id): id is string => Boolean(id)))); });
    return () => { alive = false; };
  }, []);

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

  // Shell first, then installed agents; keep the selected one even if the check missed it.
  const agents = HARNESSES
    .filter(harness => !installed || installed.has(harness.id) || harness.id === agent)
    .sort((a, b) => (a.id === "shell" ? -1 : b.id === "shell" ? 1 : 0));

  const openFolder = async () => {
    try {
      setError(null);
      await wb.choose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The folder could not be opened.");
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
      if (launch.state === "error") throw new Error(launch.error ?? `${agentLabel(agent)} did not start.`);
      localStorage.setItem(lastRunKey(projectPath), JSON.stringify({ agent, location }));
      await wb.refresh();
      go({ kind: "session", sessionId: session.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The session did not start.");
    } finally {
      setStarting(false);
    }
  };

  if (!projectPath) {
    return (
      <div className="home app-scroll">
        <section className="home-empty">
          <h1>Open a project</h1>
          <p>Pick a folder. ContextGit keeps its sessions, branches and memory in a <code>.contextgit</code> folder inside it.</p>
          <Button variant="primary" icon={<LuFolderOpen aria-hidden="true" />} onClick={() => void openFolder()}>
            Open folder
          </Button>
          {error && <p className="ui-error" role="alert">{error}</p>}
        </section>
      </div>
    );
  }

  return (
    <div className="home app-scroll">
      <section className="home-run" aria-labelledby="home-title">
        <h1 id="home-title" className="home-title">New session</h1>

        <div className="home-console">
          <div className="home-prompt">
            <span className="home-prompt-path" title={projectPath}>{promptPath(projectPath)}</span>
            <button type="button" className="home-prompt-change" onClick={() => void openFolder()} disabled={starting}>
              Change
            </button>
          </div>

          <textarea
            ref={promptRef}
            className="home-input"
            aria-label="Task for the agent"
            placeholder={agent === "shell" ? "Command to run (optional)" : "What should the agent do?"}
            value={prompt}
            rows={4}
            disabled={starting}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void start();
              }
            }}
          />

          <div className="home-options">
            <div className="home-group" role="group" aria-label="Agent">
              {agents.map(harness => (
                <Chip key={harness.id} pressed={agent === harness.id}
                  onClick={!starting ? () => setAgent(harness.id) : undefined}>
                  {harness.label}
                </Chip>
              ))}
            </div>
            <div className="home-group home-where" role="group" aria-label="Where it runs">
              <Chip pressed={location === "root"} onClick={!starting ? () => setLocation("root") : undefined}
                title="Work directly in the project folder">
                Project folder
              </Chip>
              <Chip pressed={location === "worktree"} onClick={!starting ? () => setLocation("worktree") : undefined}
                title="Work on a new branch in its own git worktree">
                New worktree
              </Chip>
            </div>
            <Button variant="primary" onClick={() => void start()} disabled={starting}
              icon={<LuCornerDownLeft aria-hidden="true" />} title="Ctrl+Enter">
              {starting ? "Starting…" : "Start"}
            </Button>
          </div>
        </div>
        {error && <p className="ui-error home-error" role="alert">{error}</p>}
      </section>

      {recent.length > 0 && (
        <section className="home-history" aria-labelledby="home-history-title">
          <h2 id="home-history-title">Recent sessions</h2>
          <ol className="ui-lane">
            {recent.map(session => (
              <li key={session.id} data-state={session.status}>
                <button type="button" className="home-run-row" onClick={() => go({ kind: "session", sessionId: session.id })}>
                  <span className="ui-sha">{session.id.slice(0, 7)}</span>
                  <span className="home-run-name" title={session.name}>{session.name}</span>
                  <span className="home-run-meta">
                    {agentLabel(session.agent)} · {STATUS_LABEL[session.status].toLowerCase()} · {relativeTime(session.updated_at || session.created_at)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
