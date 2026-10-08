import { useBackendPolling } from "../useBackendPolling";
import MergeAgentPanel from "../terminal/MergeAgentPanel";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuX } from "react-icons/lu";
import { api, ApiError, type Message, type Session, type Task } from "@/lib/api";
import { ROLE_BY_ID, roleFor, roleSkills } from "../../../shared/roles";
import { agentLabel } from "../agents";
import { Chip, Field, StatusIcon } from "../primitives";
import ProjectsRail from "../rail/ProjectsRail";
import { useFleet } from "../terminal/useFleet";
import { useMergeQueue } from "../terminal/useMergeQueue";
import HarnessLimitsPanel from "../terminal/HarnessLimitsPanel";
import { useLimits } from "../terminal/useLimits";
import TaskDetail from "../team/TaskDetail";
import TaskForm from "../team/TaskForm";
import TeamMessages from "../team/TeamMessages";
import TeamRail from "../team/TeamRail";
import EditorFeature from "./EditorFeature";
import CodeView from "../views/CodeView";
import TeamView from "../views/TeamView";
import WhyRail from "../rail/WhyRail";
import WhyView, { WhyFindingDetail } from "../views/WhyView";
import { useWhy } from "../why/useWhy";
import { useWorkbench } from "../WorkbenchContext";
import { useFeatureAction } from "../useFeatureAction";
import { FeaturePorts } from "../FeaturePorts";


export default function CodeFeature() {
  const { error: actionError, run: runAction } = useFeatureAction();
  const { backendAvailable, sessions, activeId, workspace, tab, setActiveId, refresh, revision, setProjectOpen, create, setKickoff, openSession, teamBoard, mode, setOpenIds, teamAct, remove, refreshTrash, setRevision, refreshRepo, openIds, projects, activePath, useProject, forgetProject, refreshTeam, setAutoCommit, sessionsError, teamError, model, whyRequest } = useWorkbench();
  const { fleet, error: fleetError } = useFleet();
  const whyState = useWhy(activePath ?? null, { providerId: model.providerId, modelId: model.modelId }, whyRequest);

  const mergeQueue = useMergeQueue();

  const [staged, setStaged] = useState<Message[]>([]);

  const [summary, setSummary] = useState("");
  useEffect(() => { setSummary(""); }, [activeId]);

  const [barError, setBarError] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const [taskForm, setTaskForm] = useState<{ task: Task | null } | null>(null);

  const [teamBusy, setTeamBusy] = useState(false);

  const [surface, setSurface] = useState<"runs" | "editor" | "why">("runs");

  useEffect(() => {
    if (whyRequest) setSurface("why");
  }, [whyRequest]);

  const activeSession = sessions.find((session) => session.id === activeId) ?? null;

  const [mergeAgentOpen, setMergeAgentOpen] = useState(false);

  const updateUsageActivity = useCallback(async (current: () => boolean) => {
    let active = false;
    if (workspace) {
      try { active = (await api.integrationJobs()).some(job => ["building", "reviewing", "checking", "publishing"].includes(job.state)); }
      catch { /* Authority may not be configured on an external backend. */ }
    }
    if (current()) window.contextgit?.usageActivity?.(tab === "code", active);
  }, [tab, workspace]);

  useBackendPolling(updateUsageActivity, 5000);

  const { limits, loading: limitsLoading, refresh: refreshLimits } = useLimits(tab === "code", activeSession);

  const limitsByHarness = new Map(limits.map((entry) => [entry.harness, entry]));

  const runHarness = activeSession?.agent ?? "shell";

  useEffect(() => {
    if (!activeSession) {
      setStaged([]);
      return;
    }
    let alive = true;
    void api
      .staging(activeSession.id)
      .then((items) => {
        if (alive) setStaged(items);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        if (cause instanceof ApiError && cause.status === 404 && cause.kind === "SessionNotFound") {
          setStaged([]);
          setActiveId(null);
          setBarError("This run is no longer available.");
          void refresh();
        } else setBarError(cause instanceof Error ? cause.message : "Could not load staging");
      });
    return () => {
      alive = false;
    };
  }, [activeSession, revision, refresh]);

  const startRun = useCallback(
    async (name: string, agent: string, scope: string[], roleId: string) => {
      if (!workspace) {
        setProjectOpen(true);
        throw new Error("Choose a project folder first");
      }
      const role = roleId ? ROLE_BY_ID[roleId] : undefined;
      const created = await create(
        name,
        agent,
        workspace.path,
        scope,
        role?.label,
        role ? roleSkills(role).map((skill) => skill.label) : [],
      );
      if (role) {
        // Auto-load the role's skills as this run's opening instruction.
        const skills = roleSkills(role)
          .map((skill, index) => `${index + 1}) ${skill.label} — ${skill.brief}`)
          .join(" ");
        setKickoff((current) => ({
          ...current,
          [created.id]: `You are acting as a ${role.label} on "${name}". Apply these skills on this run: ${skills} Read AGENTS.md for your file scope and the other runs.`,
        }));
      }
      openSession(created);
    },
    [create, openSession, workspace],
  );

  const newTerminal = useCallback(async (projectPath?: string) => {
    const targetPath = projectPath ?? workspace?.path;
    if (!targetPath) {
      setProjectOpen(true);
      setBarError("Choose a project folder first");
      return;
    }
    try {
      const shellCount = sessions.filter(
        (session) =>
          (session.agent ?? "shell") === "shell" && session.project_path === targetPath,
      ).length;
      const created = await create(`shell ${shellCount + 1}`, "shell", targetPath);
      openSession(created);
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not open a terminal");
    }
  }, [create, openSession, sessions, workspace]);

  const teamTasks = teamBoard?.tasks ?? [];

  const taskTitles = Object.fromEntries(teamTasks.map((task) => [task.id, task.title]));

  const selectedTask = teamTasks.find((task) => task.id === selectedTaskId) ?? null;

  const briefingFor = useCallback((task: Task) => {
    const role = roleFor(task.role);
    const parts = [
      `Read .contextgit/team.md and start task "${task.title}"${role ? ` as a ${role.label}` : ""}`,
      task.scope.length > 0 ? `you own ${task.scope.join(", ")}` : "no files claimed yet",
      task.depends_on.length > 0 ? "your dependencies are done" : "nothing blocks you",
    ];
    const skills = role
      ? ` Apply these skills: ${roleSkills(role).map((skill) => skill.label).join(", ")}.`
      : "";
    return `${parts.join(". ")}.${skills} Post a note when you finish.`;
  }, []);

  const verifierBriefingFor = useCallback((task: Task) => {
    const criteria = task.done_criteria ? `Done criteria: ${task.done_criteria}. ` : "";
    return (
      `Read .contextgit/team.md and review task "${task.title}" as an independent verifier. ` +
      `${criteria}Inspect the diff of this branch against the criteria, then post your ` +
      "findings as a note. Do not change any files."
    );
  }, []);

  const openedTeamSessions = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (mode !== "team") return;
    const entries: Array<{ id: string; briefing: string }> = [];
    for (const task of teamBoard?.tasks ?? []) {
      if (task.status === "working" && task.session_id) {
        entries.push({ id: task.session_id, briefing: briefingFor(task) });
      }
      if (task.verifier_session_id) {
        entries.push({ id: task.verifier_session_id, briefing: verifierBriefingFor(task) });
      }
    }
    const fresh = entries.filter((entry) => !openedTeamSessions.current.has(entry.id));
    if (fresh.length === 0) return;
    for (const entry of fresh) openedTeamSessions.current.add(entry.id);
    setOpenIds((current) => {
      const next = [...current];
      for (const entry of fresh) if (!next.includes(entry.id)) next.push(entry.id);
      return next;
    });
    setActiveId(fresh[0].id);
    setKickoff((current) => {
      const next = { ...current };
      for (const entry of fresh) if (!next[entry.id]) next[entry.id] = entry.briefing;
      return next;
    });
  }, [briefingFor, mode, teamBoard, verifierBriefingFor]);

  const openTaskTerminal = useCallback(
    (sessionId: string) => {
      const session = sessions.find((entry) => entry.id === sessionId);
      if (session) openSession(session);
    },
    [openSession, sessions],
  );

  const launchTeam = useCallback(async () => {
    setTeamBusy(true);
    try {
      await teamAct(() => api.launchTeam());
      setBarError(null);
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not launch the team");
    } finally {
      setTeamBusy(false);
    }
  }, [teamAct]);

  const mergeTeam = useCallback(async () => {
    setTeamBusy(true);
    try {
      await api.mergeTeam();
      setBarError(null);
      await refresh();
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not queue the finished runs");
    } finally {
      setTeamBusy(false);
    }
  }, [refresh]);

  const selectTask = useCallback((task: Task) => setSelectedTaskId(task.id), []);

  const createTeam = useCallback(
    async (name: string) => {
      if (!workspace) {
        setProjectOpen(true);
        return;
      }
      setTeamBusy(true);
      try {
        await teamAct(() => api.createTeam({ name, projectPath: workspace.path }));
        setBarError(null);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not create the team");
      } finally {
        setTeamBusy(false);
      }
    },
    [teamAct, workspace],
  );

  const deleteRun = useCallback(
    async (session: Session) => {
      try {
        await remove(session.id);
        setOpenIds((current) => current.filter((id) => id !== session.id));
        setActiveId((current) => (current === session.id ? null : current));
        await refreshTrash();
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not delete run");
      }
    },
    [remove, refreshTrash],
  );

  const commitStaged = useCallback(async () => {
    if (!activeSession || staged.length === 0) return;
    try {
      await api.commitStaged(activeSession.id, summary.trim() || undefined);
      setSummary("");
      setStaged([]);
      setBarError(null);
      setRevision((value) => value + 1);
      await refresh();
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Commit failed");
    }
  }, [activeSession, refresh, staged.length, summary]);

  const undoLast = useCallback(async () => {
    if (!activeSession) return;
    try {
      setStaged(await api.unstage(activeSession.id, true));
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not unstage");
    }
  }, [activeSession]);

  const clearStaged = useCallback(async () => {
    if (!activeSession) return;
    try {
      setStaged(await api.unstage(activeSession.id));
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not clear staging");
    }
  }, [activeSession]);

  const queueRun = useCallback(
    async (session: Session) => {
      try {
        await mergeQueue.enqueue(session.id);
        setBarError(null);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not queue the run");
      }
    },
    [mergeQueue],
  );

  const mergeQueuedRuns = useCallback(async () => {
    try {
      await mergeQueue.run();
      setBarError(null);
      await refresh();
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not merge the queue");
    }
  }, [mergeQueue, refresh]);

  const dropQueued = useCallback(
    async (id: number) => {
      try {
        await mergeQueue.dequeue(id);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not remove the entry");
      }
    },
    [mergeQueue],
  );

  const integrateActiveRun = useCallback(async () => {
    if (!activeSession) return;
    try {
      await api.integrateRun(activeSession.id);
      setBarError(null);
      await refresh();
      await refreshRepo();
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not integrate the run");
    }
  }, [activeSession, refresh, refreshRepo]);

  if (surface === "editor") {
    return <EditorFeature onClose={() => setSurface("runs")} />;
  }

  const rail = () => {
    if (surface === "why") return <WhyRail state={whyState} />;
    return mode === "team" ? (
      <TeamRail
        onMergeAgent={() => setMergeAgentOpen(value => !value)}
        tasks={teamTasks}
        sessions={sessions}
        selectedId={selectedTaskId}
        onSelect={selectTask}
        onNew={() => setTaskForm({ task: null })}
      />
    ) : (
      <ProjectsRail
        onMergeAgent={() => setMergeAgentOpen(value => !value)}
        sessions={sessions.filter((session) => session.kind === "terminal")}
        fleet={fleet}
        openIds={openIds}
        activeId={activeId}
        limits={Object.fromEntries(limitsByHarness)}
        projects={projects}
        activePath={activePath}
        onSelect={openSession}
        onNew={startRun}
        onNewTerminal={(projectPath) => void newTerminal(projectPath)}
        backendAvailable={backendAvailable}
        onDelete={(session) => void deleteRun(session)}
        onUseProject={(path) => void runAction(() => useProject(path))}
        onForgetProject={(path) => void runAction(() => forgetProject(path))}
        onChooseProject={() => setProjectOpen(true)}
      />
    );
  };

  const view = () => <>
    {surface === "why" ? <WhyView state={whyState} /> : <>
    {mergeAgentOpen && workspace && <MergeAgentPanel project={workspace.path} sessions={sessions} />}

    {mode === "team" ? (
      <TeamView
        tasks={teamTasks}
        sessions={sessions}
        selectedId={selectedTaskId}
        teamName={teamBoard?.team.name ?? null}
        busy={teamBusy}
        workspaceName={workspace?.name ?? null}
        onSelectTask={selectTask}
        onNewTask={() => setTaskForm({ task: null })}
        onLaunch={() => void launchTeam()}
        onMerge={() => void mergeTeam()}
        onCreateTeam={(name) => void createTeam(name)}
        onChooseProject={() => setProjectOpen(true)}
      />
    ) : (
      <CodeView
        sessions={sessions}
        fleet={fleet}
        openIds={openIds}
        workspace={workspace}
        onNewTerminal={() => void newTerminal()}
        backendAvailable={backendAvailable}
        onChooseProject={() => setProjectOpen(true)}
        onOpenEditor={() => setSurface("editor")}
        onOpenWhy={() => setSurface("why")}
      />
    )}

    {/* One canvas for both modes: switching must never restart an agent. */}
    </>}

  </>;

  const dock = () => {
    if (surface === "why") {
      const finding = whyState.answer?.findings[0];
      return finding ? (
        <WhyFindingDetail finding={finding} />
      ) : (
        <p className="cg-empty-note">Explain a file to inspect its recorded reasoning.</p>
      );
    }
    if (mode === "team") {
      return selectedTask ? (
        <>
          <TaskDetail
            task={selectedTask}
            titles={taskTitles}
            session={
              selectedTask.session_id
                ? sessions.find((entry) => entry.id === selectedTask.session_id) ?? null
                : null
            }
            verifier={
              selectedTask.verifier_session_id
                ? sessions.find((entry) => entry.id === selectedTask.verifier_session_id) ??
                null
                : null
            }
            onChanged={() => void refreshTeam()}
            onEdit={() => setTaskForm({ task: selectedTask })}
            onOpenTerminal={openTaskTerminal}
          />
          <div className="cg-dock-group">
            <span className="cg-kicker">Board feed</span>
            <TeamMessages messages={teamBoard?.messages ?? []} titles={taskTitles} />
          </div>
        </>
      ) : (
        <p className="cg-empty-note">Select a task to inspect it.</p>
      );
    }
    return activeSession ? (
      <>
        <div className="cg-fields">
          <Field label="Run">{activeSession.name}</Field>
          <Field label="Agent">{agentLabel(activeSession.agent)}</Field>
          <Field label="Branch">
            <Chip>{activeSession.branch}</Chip>
          </Field>
          <Field label="Status">
            <span className="cg-inline">
              <StatusIcon status={activeSession.status} />
              {activeSession.status}
            </span>
          </Field>
          <Field label="Staged">{staged.length}</Field>
        </div>
        <div className="cg-dock-group">
          <label className="cg-toggle">
            <input
              type="checkbox"
              checked={activeSession.auto_commit}
              onChange={(event) => { const checked = event.target.checked; void runAction(() => setAutoCommit(activeSession.id, checked)); }}
            />
            Auto-checkpoint
          </label>
        </div>
        <div className="cg-dock-group">
          <span className="cg-kicker">Merge queue</span>
          {mergeQueue.queue.length === 0 ? (
            <p className="cg-empty-note">Queue runs to merge their branches, one at a time.</p>
          ) : (
            <ul className="cg-queue">
              {mergeQueue.queue.map((entry) => (
                <li key={entry.id} className="cg-queue-row">
                  <span className="cg-queue-name">
                    {sessions.find((session) => session.id === entry.session_id)?.name ??
                      entry.session_id.slice(0, 6)}
                  </span>
                  <Chip
                    tone={
                      entry.status === "merged"
                        ? "ok"
                        : entry.status === "queued"
                          ? undefined
                          : "bad"
                    }
                  >
                    {entry.status}
                  </Chip>
                  <button
                    type="button"
                    className="cg-icon-btn"
                    aria-label="Remove from queue"
                    onClick={() => void dropQueued(entry.id)}
                  >
                    <LuX aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="cg-dock-actions">
            <button
              type="button"
              className="cg-btn"
              disabled={!activeSession?.git_branch}
              onClick={() => activeSession && void queueRun(activeSession)}
            >
              Queue this run
            </button>
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={!mergeQueue.queue.some((entry) => entry.status === "queued")}
              onClick={() => void mergeQueuedRuns()}
            >
              Merge queue
            </button>
            <button
              type="button"
              className="cg-btn"
              data-wide="true"
              disabled={!activeSession?.git_branch}
              onClick={() => void integrateActiveRun()}
            >
              Integrate code + context
            </button>
          </div>
        </div>
        <div className="cg-dock-actions">
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            onClick={() => void commitStaged()}
            disabled={staged.length === 0}
          >
            Checkpoint now
          </button>
          <button
            type="button"
            className="cg-btn"
            data-variant="danger"
            onClick={() => void deleteRun(activeSession)}
          >
            Delete run
          </button>
        </div>
        <HarnessLimitsPanel
          harness={runHarness}
          limits={limitsByHarness.get(runHarness)}
          loading={limitsLoading}
          onRefresh={refreshLimits}
        />
      </>
    ) : (
      <p className="cg-empty-note">Select a run to inspect it.</p>
    );
  };

  const footer = () => {
    if (surface === "why") {
      return (
        <footer className="cg-bottombar" aria-label="Why actions">
          <span className="cg-bb-info">
            <strong>Why this code?</strong>
            <span className="cg-view-sub">Trace decisions and rejected alternatives.</span>
          </span>
          <span className="cg-bb-actions cg-bb-end">
            <button type="button" className="cg-btn" onClick={() => setSurface("runs")}>
              Back to runs
            </button>
          </span>
        </footer>
      );
    }
    if (tab === "code" && mode === "team") {
      return (
        <footer className="cg-bottombar">
          <span className="cg-bb-info">
            <strong>{teamBoard?.team.name ?? "Team"}</strong>
            <Chip>{teamTasks.length} tasks</Chip>
            <span className="cg-view-sub">
              {teamTasks.filter((task) => task.status === "working").length} working ·{" "}
              {teamTasks.filter((task) => task.status === "review").length} in review ·{" "}
              {teamTasks.filter((task) => task.status === "blocked").length} blocked
            </span>
          </span>
          <span className="cg-bb-actions cg-bb-end">
            <button type="button" className="cg-btn" onClick={() => setTaskForm({ task: null })}>
              New task
            </button>
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={teamBusy || teamTasks.length === 0}
              onClick={() => void launchTeam()}
            >
              {teamBusy ? "Working…" : "Launch team"}
            </button>
            <button
              type="button"
              className="cg-btn"
              disabled={teamBusy || !teamTasks.some((task) => task.status === "done")}
              onClick={() => void mergeTeam()}
            >
              Merge done
            </button>
          </span>
        </footer>
      );
    }
    return (
      <footer className="cg-bottombar" aria-label="Commit staged messages">
        <span className="cg-bb-info">
          <strong>{activeSession?.name ?? "No run selected"}</strong>
          {activeSession && <Chip>{activeSession.branch}</Chip>}
          <span className="cg-view-sub">{staged.length} staged</span>
        </span>
        <input
          type="text"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder={staged.length ? "Commit summary (optional)" : "Stage output from a terminal first…"}
          aria-label="Commit summary"
          disabled={staged.length === 0}
        />
        <span className="cg-bb-actions">
          <button type="button" className="cg-btn" onClick={() => void undoLast()} disabled={staged.length === 0}>
            Undo
          </button>
          <button type="button" className="cg-btn" onClick={() => void clearStaged()} disabled={staged.length === 0}>
            Clear
          </button>
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            onClick={() => void commitStaged()}
            disabled={staged.length === 0}
          >
            Commit {staged.length || ""}
          </button>
        </span>
      </footer>
    );
  };

  const dialogs = () => <>{taskForm && (
    <TaskForm
      task={taskForm.task}
      tasks={teamTasks}
      onSaved={() => void refreshTeam()}
      onClose={() => setTaskForm(null)}
    />
  )}</>;
  return <FeaturePorts id="code"
    title={mode === "team" ? "Task" : "Run"}
    rail={rail}
    view={view}
    dock={dock}
    footer={footer}
    dialogs={dialogs}
    onDismissDialogs={() => { setTaskForm(null); }}
    hasModal={taskForm !== null}
    notice={actionError ?? barError ?? sessionsError ?? fleetError ?? teamError ?? mergeQueue.error} />;
}
