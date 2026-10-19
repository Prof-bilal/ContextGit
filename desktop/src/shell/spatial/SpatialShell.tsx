import {
  Background,
  Controls,
  MiniMap,
  NodeResizer,
  Panel,
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./spatial.css";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  LuBot,
  LuChevronDown,
  LuChevronUp,
  LuFile,
  LuFolderOpen,
  LuGrip,
  LuMemoryStick,
  LuPause,
  LuPlay,
  LuPlus,
  LuSend,
  LuSparkles,
  LuUsers,
  LuX,
} from "react-icons/lu";

import {
  projectApi,
  type Session,
  type SpatialTeam,
  type TeamPlanTask,
} from "@/shared/api";
import { HARNESSES } from "@/shared/harnesses";
import { SKILLS } from "@/shared/roles";
import { terminalRuntime } from "../terminal/runtime";
import { useWorkbenchState } from "../useWorkbenchState";
import SkillsPanel from "./SkillsPanel";
import VoiceInput from "./VoiceInput";
import PlanReview from "./PlanReview";
import FilesPanel from "./FilesPanel";
import PresetsPanel, { type TeamPreset } from "./PresetsPanel";
import { useCanvasPreference } from "./useCanvasPreference";

const RuntimeTerminal = lazy(() => import("../terminal/RuntimeTerminal"));

function OutputTail({ id }: { id: string }) {
  const snapshot = useSyncExternalStore(
    (listener) => terminalRuntime.subscribe(id, listener),
    () => terminalRuntime.snapshot(id),
  );
  return (
    <code className="sp-output-tail">
      {snapshot.error ??
        (snapshot.tail.slice(-700) || "Waiting for CLI output…")}
    </code>
  );
}

type TeamNodeData = {
  team: SpatialTeam;
  sessions: Session[];
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (team: SpatialTeam) => void;
  onOpen: (session: Session) => void;
  onPause: (team: SpatialTeam) => void;
  selectedWorkers: string[];
  onWorkerSelect: (id: string) => void;
  onReorder: (team: SpatialTeam, source: string, target: string) => void;
  onResize: (
    team: SpatialTeam,
    width: number,
    height: number,
    position: { x: number; y: number },
  ) => void;
  onJob: (team: SpatialTeam) => void;
};

type MergePreview = {
  ready: boolean;
  unfinished: string[];
  changes: Array<{
    title: string;
    status: string;
    gate_status?: string | null;
    gate_output?: string | null;
    conflicts?: string[];
    uncommitted?: string[];
    files: Array<{ status: string; path: string }>;
  }>;
  requires_confirmation: boolean;
};

function workerSession(team: SpatialTeam, taskId: string, sessions: Session[]) {
  const task = team.tasks.find((entry) => entry.id === taskId);
  return task?.session_id
    ? sessions.find((session) => session.id === task.session_id)
    : undefined;
}

function TeamNode({ data }: NodeProps<Node<TeamNodeData>>) {
  const { team, sessions } = data;
  const collapsed = team.layout.collapsed;
  const workers = team.tasks.slice(0, 12);
  return (
    <section
      className="sp-team nopan"
      style={{ minHeight: collapsed ? undefined : team.layout.height }}
      data-selected={data.selected}
      data-state={team.team.state}
      onPointerDown={() => data.onSelect(team.team.id)}
    >
      <NodeResizer
        isVisible={data.selected && !collapsed}
        minWidth={640}
        minHeight={220}
        maxWidth={2400}
        maxHeight={1800}
        onResizeEnd={(_event, params) =>
          data.onResize(team, params.width, params.height, {
            x: params.x,
            y: params.y,
          })
        }
      />
      <header className="sp-team-head">
        <span className="sp-team-drag" aria-hidden="true">
          <LuGrip />
        </span>
        <span className="sp-team-mark">
          <LuBot />
        </span>
        <span className="sp-team-title">
          <strong>{team.team.name}</strong>
          <small>{team.team.state}</small>
        </span>
        <span className="sp-team-count">
          1 orchestrator · {workers.length} workers
        </span>
        <button
          className="sp-icon nodrag"
          title="Open orchestration job file"
          aria-label="Open orchestration job file"
          onClick={() => data.onJob(team)}
        >
          <LuFile />
        </button>
        <button
          className="sp-icon nodrag"
          onClick={() => data.onToggle(team)}
          aria-label={collapsed ? "Expand team" : "Collapse team"}
        >
          {collapsed ? <LuChevronDown /> : <LuChevronUp />}
        </button>
      </header>
      {!collapsed && (
        <>
          <div
            className="sp-orchestrator nodrag"
            role="button"
            tabIndex={0}
            onClick={() => {
              const session = sessions.find(
                (item) => item.id === team.team.orchestrator_session_id,
              );
              if (session) data.onOpen(session);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const session = sessions.find(
                  (item) => item.id === team.team.orchestrator_session_id,
                );
                if (session) data.onOpen(session);
              }
            }}
          >
            <span className="sp-orchestrator-icon">
              <LuSparkles />
            </span>
            <span>
              <strong>Orchestrator</strong>
              <small>
                {team.team.orchestrator_agent ?? "Choose CLI"} · directing{" "}
                {workers.length} agents
              </small>
            </span>
            <span className="sp-goal">
              {team.team.goal || "Waiting for a goal…"}
            </span>
            <span className="sp-state-dot" />
          </div>
          <div className="sp-workers nodrag" data-count={workers.length}>
            {workers.length === 0 && (
              <div className="sp-empty-team">
                <LuUsers />
                <strong>No workers yet</strong>
                <span>Enter a goal, review the plan, then launch.</span>
              </div>
            )}
            {workers.map((task) => {
              const session = workerSession(team, task.id, sessions);
              return (
                <button
                  key={task.id}
                  type="button"
                  className="sp-worker"
                  data-status={task.status}
                  aria-pressed={data.selectedWorkers.includes(task.id)}
                  title="Click to inspect; Shift+click to select for grouping. Drag to reorder."
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData(
                      "text/contextgit-worker",
                      task.id,
                    )
                  }
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    data.onReorder(
                      team,
                      event.dataTransfer.getData("text/contextgit-worker"),
                      task.id,
                    );
                  }}
                  onClick={(event) => {
                    if (event.shiftKey) data.onWorkerSelect(task.id);
                    else if (session) data.onOpen(session);
                  }}
                >
                  <span className="sp-worker-head">
                    <span className="sp-agent-pixel">✣</span>
                    <strong>{session?.name ?? task.title}</strong>
                    <em>{task.status}</em>
                  </span>
                  <span className="sp-worker-meta">
                    {task.agent ?? "unassigned"} · {task.role}
                  </span>
                  {session ? (
                    <OutputTail id={session.id} />
                  ) : (
                    <code>
                      &gt; {task.brief || task.title}
                      <br />› {task.status}
                    </code>
                  )}
                  <span className="sp-progress">
                    <i
                      style={{ width: task.status === "done" ? "100%" : "0%" }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

const nodeTypes = { team: TeamNode };

export default function SpatialShell({
  backendAvailable = true,
}: {
  backendAvailable?: boolean;
}) {
  const shared = useWorkbenchState();
  const [teams, setTeams] = useState<SpatialTeam[]>([]);
  const [nodes, setNodes] = useState<Node<TeamNodeData>[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [flowVersion, setFlowVersion] = useState(0);
  const [teamDialog, setTeamDialog] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useCanvasPreference(
    shared.workspace?.path,
    "skills",
    false,
  );
  const [filesOpen, setFilesOpen] = useCanvasPreference(
    shared.workspace?.path,
    "files",
    false,
  );
  const [terminalSession, setTerminalSession] = useState<Session | null>(null);
  const [name, setName] = useState("Team 01");
  const [goal, setGoal] = useState("");
  const [orchestrator, setOrchestrator] = useState("claude");
  const [planTasks, setPlanTasks] = useState<TeamPlanTask[]>([]);
  const [command, setCommand] = useState("");
  const [commandTarget, setCommandTarget] = useState("orchestrator");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenPlanRevision = useRef<Record<string, number>>({});
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const migratedProjects = useRef(new Set<string>());
  const [memory, setMemory] = useState<string | null>(null);
  const [presetsOpen, setPresetsOpen] = useCanvasPreference(
    shared.workspace?.path,
    "presets",
    false,
  );
  const [draftPreset, setDraftPreset] = useState<TeamPreset | null>(null);
  const [selectedWorkers, setSelectedWorkers] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("New team");
  const [groupDialog, setGroupDialog] = useState(false);
  const [workerDialog, setWorkerDialog] = useState(false);
  const [workerName, setWorkerName] = useState("New worker");
  const [workerScope, setWorkerScope] = useState("");
  const [workerBrief, setWorkerBrief] = useState("");
  const [jobPath, setJobPath] = useState<string | undefined>();
  const [draftSkills, setDraftSkills] = useState<string[]>([]);
  const canvasFlow = useRef<{
    screenToFlowPosition: (point: { x: number; y: number }) => {
      x: number;
      y: number;
    };
  } | null>(null);
  const [draftLocation, setDraftLocation] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const currentProject = useRef(shared.workspace?.path);
  currentProject.current = shared.workspace?.path;

  const api = useMemo(
    () => projectApi(shared.workspace?.path),
    [shared.workspace?.path],
  );
  const loadTeams = useCallback(async () => {
    if (!shared.workspace || !backendAvailable) {
      setTeams([]);
      return;
    }
    const owner = shared.workspace.path;
    try {
      const next = await api.teams(owner);
      if (currentProject.current === owner) {
        setTeams(next);
        setError(null);
      }
    } catch (cause) {
      if (currentProject.current === owner)
        setError(
          cause instanceof Error ? cause.message : "Could not load teams",
        );
    }
  }, [api, backendAvailable, shared.workspace?.path]);

  useEffect(() => {
    void loadTeams();
    const timer = window.setInterval(() => void loadTeams(), 4000);
    return () => window.clearInterval(timer);
  }, [loadTeams]);

  useEffect(() => {
    const path = shared.workspace?.path;
    if (!path || !backendAvailable || migratedProjects.current.has(path))
      return;
    migratedProjects.current.add(path);
    void api
      .importCanvasSessions(path)
      .then(loadTeams)
      .catch((cause) => {
        migratedProjects.current.delete(path);
        setError(String(cause));
      });
  }, [api, backendAvailable, shared.workspace?.path]);

  const openTerminal = useCallback(
    (session: Session) => {
      shared.openSession(session);
      setTerminalSession(session);
      if (terminalRuntime.session(session.id)) return;
      const owner = teams.find(
        (team) =>
          team.team.orchestrator_session_id === session.id ||
          team.tasks.some((task) => task.session_id === session.id),
      );
      const task = owner?.tasks.find((task) => task.session_id === session.id);
      if (["done", "error"].includes(session.status)) {
        void terminalRuntime.restore(session);
        return;
      }
      const start =
        task && ["todo", "blocked"].includes(task.status)
          ? api.startSpatialTask(owner!.team.id, task.id).then(() => {})
          : Promise.resolve();
      void start
        .then(() => terminalRuntime.ensure(session, owner?.team.id, task?.id))
        .catch((cause) => setError(String(cause)));
    },
    [api, teams, shared.openSession],
  );

  useEffect(() => {
    setNodes((current) =>
      teams
        .filter((team) => team.team.project_path === currentProject.current)
        .map((team) => {
          const old = current.find((node) => node.id === team.team.id);
          return {
            ...old,
            id: team.team.id,
            type: "team",
            position: old?.position ?? { x: team.layout.x, y: team.layout.y },
            data: {
              team,
              sessions: shared.sessions,
              selected: selectedId === team.team.id,
              onSelect: setSelectedId,
              onOpen: openTerminal,
              onToggle: async (entry: SpatialTeam) => {
                await api.updateTeamLayout(entry.team.id, {
                  ...entry.layout,
                  collapsed: !entry.layout.collapsed,
                });
                await loadTeams();
              },
              onPause: async (entry: SpatialTeam) => {
                if (entry.team.state === "paused")
                  await api.resumeSpatialTeam(entry.team.id);
                else await api.pauseSpatialTeam(entry.team.id);
                await loadTeams();
              },
              selectedWorkers,
              onWorkerSelect: (id: string) =>
                setSelectedWorkers((current) =>
                  current.includes(id)
                    ? current.filter((item) => item !== id)
                    : [...current, id],
                ),
              onReorder: (
                entry: SpatialTeam,
                source: string,
                target: string,
              ) => {
                const ids = entry.tasks.map((task) => task.id);
                const from = ids.indexOf(source),
                  to = ids.indexOf(target);
                if (from < 0 || to < 0) return;
                ids.splice(to, 0, ids.splice(from, 1)[0]);
                void api
                  .reorderCanvasWorkers(entry.team.id, ids)
                  .then(loadTeams)
                  .catch((cause) => setError(String(cause)));
              },
              onResize: (
                entry: SpatialTeam,
                width: number,
                height: number,
                position: { x: number; y: number },
              ) => {
                void api
                  .updateTeamLayout(entry.team.id, {
                    ...entry.layout,
                    ...position,
                    width,
                    height,
                  })
                  .then(loadTeams)
                  .catch((cause) => setError(String(cause)));
              },
              onJob: (entry: SpatialTeam) => {
                setJobPath(`.contextgit/teams/${entry.team.id}/job.json`);
                setFilesOpen(true);
              },
            },
            draggable: true,
            dragHandle: ".sp-team-head",
            selectable: true,
            style: {
              width: team.layout.collapsed ? 520 : team.layout.width,
              zIndex: team.layout.z_index,
            },
          } satisfies Node<TeamNodeData>;
        }),
    );
  }, [
    api,
    loadTeams,
    openTerminal,
    selectedId,
    selectedWorkers,
    shared.sessions,
    teams,
  ]);

  const selected =
    teams.find(
      (team) =>
        team.team.id === selectedId &&
        team.team.project_path === currentProject.current,
    ) ?? null;
  useEffect(() => {
    setPlanOpen(false);
    setMergeOpen(false);
    setCommandTarget("orchestrator");
  }, [selectedId]);
  const viewportProjectPath = shared.activePath ?? shared.workspace?.path;
  const viewportSaveTimer = useRef<number | null>(null);
  const lastSavedViewport = useRef("");

  useEffect(() => {
    setSelectedId(undefined);
    setSelectedWorkers([]);
    setGroupDialog(false);
    setWorkerDialog(false);
    setTeamDialog(false);
    setTerminalSession(null);
    setJobPath(undefined);
    setMemory(null);
    lastSavedViewport.current = "";
    setFlowVersion((version) => version + 1);
  }, [viewportProjectPath]);

  useEffect(
    () => () => {
      if (viewportSaveTimer.current !== null)
        window.clearTimeout(viewportSaveTimer.current);
    },
    [],
  );
  const liveSessionIds = [
    ...new Set(
      teams
        .flatMap((team) => [
          team.team.orchestrator_session_id,
          ...team.tasks.flatMap((task) => [
            task.session_id,
            task.verifier_session_id,
          ]),
        ])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  useEffect(() => {
    if (
      liveSessionIds.some(
        (id) => !shared.sessions.some((session) => session.id === id),
      )
    )
      void shared.refresh();
  }, [
    liveSessionIds.join("|"),
    shared.refresh,
    shared.sessions,
    terminalSession,
  ]);

  useEffect(() => {
    for (const team of teams) {
      const ids = [
        team.team.orchestrator_session_id,
        ...team.tasks.flatMap((task) => [
          task.session_id,
          task.verifier_session_id,
        ]),
      ];
      for (const id of ids) {
        const session = shared.sessions.find((entry) => entry.id === id);
        if (!session) continue;
        if (["done", "error"].includes(session.status)) {
          void terminalRuntime.restore(session);
          continue;
        }
        if (team.team.name === "Ungrouped runs" && session.status !== "running")
          continue;
        const task = team.tasks.find(
          (entry) =>
            entry.session_id === id || entry.verifier_session_id === id,
        );
        if (task && !["working", "review"].includes(task.status)) continue;
        const skills = team.skills
          .filter((link) => !link.task_id || link.task_id === task?.id)
          .map((link) => `${link.title}: ${link.instruction}`)
          .join("\n");
        const briefing =
          session.role === "orchestrator"
            ? `You are the orchestrator for team ${team.team.name}. Goal: ${team.team.goal}. ${team.plan?.status === "approved" ? "The user has approved the existing plan. Read team_status and list_tasks to coordinate its workers." : "Use propose_team_plan to submit 3-6 workers with roles, CLI, scopes, dependencies, completion criteria and gates. Wait for user approval before launching work."} Monitor the team and review completed tasks. Use prepare_merge when ready; only the user can confirm integration. After completion, you may propose_skill with reviewed evidence; drafts require user review.\n${skills}`
            : `Role: ${session.role ?? "worker"}. Task: ${task?.brief ?? session.task ?? ""}\nCompletion criteria: ${task?.done_criteria ?? ""}\nOwned files: ${task?.scope.join(", ") ?? ""}\nRead AGENTS.md. Test and commit implementation changes before calling complete_task. Use team tools to report progress. Never merge into the target branch yourself.\n${skills}`;
        void terminalRuntime.ensure(session, team.team.id, task?.id, briefing);
      }
    }
  }, [teams, shared.sessions]);

  useEffect(() => {
    if (!selected?.plan || selected.plan.status !== "draft" || planOpen) return;
    if (seenPlanRevision.current[selected.team.id] === selected.plan.revision)
      return;
    const tasks = selected.plan.plan.tasks ?? [];
    if (!tasks.length) return;
    seenPlanRevision.current[selected.team.id] = selected.plan.revision;
    setPlanTasks(tasks);
    setPlanOpen(true);
    setTerminalSession(null);
  }, [planOpen, selected?.plan]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<TeamNodeData>>[]) => {
      setNodes((current) => applyNodeChanges(changes, current));
      for (const change of changes) {
        if (
          change.type !== "position" ||
          change.dragging !== false ||
          !change.position
        )
          continue;
        const team = teams.find((entry) => entry.team.id === change.id);
        if (team)
          void api
            .updateTeamLayout(team.team.id, {
              ...team.layout,
              ...change.position,
            })
            .catch((cause) => setError(String(cause)));
      }
    },
    [api, teams],
  );

  const savePosition = useCallback(
    async (_event: unknown, node: Node<TeamNodeData>) => {
      const team = teams.find((entry) => entry.team.id === node.id);
      if (!team) return;
      try {
        await api.updateTeamLayout(team.team.id, {
          ...team.layout,
          x: node.position.x,
          y: node.position.y,
          z_index: Math.max(...teams.map((entry) => entry.layout.z_index)) + 1,
        });
      } catch (cause) {
        setError(String(cause));
      }
    },
    [api, teams],
  );

  const createTeam = async () => {
    if (!shared.workspace || !goal.trim() || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createSpatialTeam({
        name: name.trim(),
        projectPath: shared.workspace.path,
        goal: goal.trim(),
        orchestratorAgent: orchestrator,
      });
      if (draftLocation)
        await api.updateTeamLayout(created.team.id, {
          ...created.layout,
          ...draftLocation,
        });
      for (const identity of draftSkills) {
        const skill = SKILLS[identity];
        if (skill)
          await api.attachTeamSkill(created.team.id, {
            skill_id: skill.id,
            title: skill.label,
            instruction: skill.brief,
            origin: "built-in",
          });
      }
      const session = await api.startOrchestrator(created.team.id);
      if (draftPreset)
        await api.saveTeamPlan(created.team.id, goal.trim(), draftPreset.tasks);
      shared.setKickoff((current) => ({
        ...current,
        [session.id]: `You are the orchestrator for team "${created.team.name}". Goal: ${goal.trim()}. Inspect the project and propose 3-6 bounded worker tasks with disjoint file scopes, dependencies, done criteria, agents, and relevant skills.`,
      }));
      shared.openSession(session);
      setSelectedId(created.team.id);
      setTerminalSession(session);
      setTeamDialog(false);
      setName(`Team ${String(teams.length + 2).padStart(2, "0")}`);
      setGoal("");
      await loadTeams();
      setDraftPreset(null);
      setDraftSkills([]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create team",
      );
    } finally {
      setBusy(false);
    }
  };

  const approvePlan = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.saveTeamPlan(
        selected.team.id,
        selected.team.goal,
        planTasks.map((task) => ({
          ...task,
          scope: task.scope?.filter((value) => value.trim()),
          depends_on: task.depends_on?.filter((value) => value.trim()),
          skills: task.skills?.filter((value) => value.trim()),
        })),
      );
      await api.approveTeamPlan(selected.team.id);
      setPlanOpen(false);
      await shared.refresh();
      await loadTeams();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not approve plan",
      );
    } finally {
      setBusy(false);
    }
  };

  const openMergeReview = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      setMergePreview(await api.previewSpatialTeamMerge(selected.team.id));
      setMergeOpen(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not prepare merge review",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmMerge = async () => {
    if (!selected || !mergePreview?.ready) return;
    setBusy(true);
    try {
      const result = await api.confirmSpatialTeamMerge(selected.team.id);
      if (result.completed === false)
        throw new Error(
          "Merge stopped because one or more branches could not be integrated. Review conflicts before retrying.",
        );
      setMergeOpen(false);
      setMergePreview(null);
      await loadTeams();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not merge team");
    } finally {
      setBusy(false);
    }
  };

  const spawnAgent = async () => {
    if (!selected || selected.tasks.length >= 12) return;
    const title = workerName.trim();
    if (!title) return;
    setBusy(true);
    try {
      const task = await api.createSpatialTask(selected.team.id, {
        title,
        role: "implementer",
        agent: selected.team.orchestrator_agent ?? "claude",
        brief: workerBrief || selected.team.goal,
        scope: workerScope
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      if (selected.team.state !== "paused" && selected.team.state !== "draft") {
        await api.startSpatialTask(selected.team.id, task.id);
      }
      await shared.refresh();
      await loadTeams();
      setWorkerDialog(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not spawn worker",
      );
    } finally {
      setBusy(false);
    }
  };

  const sendCommand = async () => {
    if (!selected || !command.trim()) return;
    try {
      const targetTask =
        commandTarget === "orchestrator"
          ? undefined
          : selected.tasks.find((task) => task.id === commandTarget);
      if (commandTarget !== "orchestrator" && !targetTask?.session_id)
        throw new Error("The selected worker is unavailable.");
      let session = shared.sessions.find(
        (entry) =>
          entry.id ===
          (targetTask?.session_id ?? selected.team.orchestrator_session_id),
      );
      if (!session && commandTarget !== "orchestrator")
        throw new Error("Wait for the worker session to load.");
      if (!session) session = await api.startOrchestrator(selected.team.id);
      const text = command.trim();
      await terminalRuntime.ensure(session, selected.team.id, targetTask?.id);
      await terminalRuntime.send(session.id, `${text}\r`);
      shared.openSession(session);
      setTerminalSession(session);
      setCommand("");
    } catch (cause) {
      setError(String(cause));
    }
  };

  const openFiles = () => {
    setJobPath(undefined);
    setFilesOpen(true);
  };

  return (
    <div className="sp-shell">
      {!shared.workspace ? (
        <div className="sp-welcome">
          <LuBot />
          <h1>Spatial agent teams</h1>
          <p>Open a project to place your first team on the canvas.</p>
          <button onClick={() => void shared.choose()}>
            <LuFolderOpen /> Open project
          </button>
        </div>
      ) : (
        <ReactFlow
          key={flowVersion}
          nodes={nodes}
          edges={[]}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={savePosition}
          onPaneContextMenu={(event) => {
            event.preventDefault();
            setDraftLocation(
              canvasFlow.current?.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
              }) ?? null,
            );
            setTeamDialog(true);
          }}
          onNodeClick={(_event, node) => setSelectedId(node.id)}
          onNodeDragStart={(_event, node) => setSelectedId(node.id)}
          onInit={(flow) => {
            // Retain only the coordinate conversion used when placing new teams.
            canvasFlow.current = flow;
            if (!viewportProjectPath || !backendAvailable) return;
            const projectPath = viewportProjectPath;
            const ownerApi = projectApi(projectPath);
            void ownerApi
              .canvasViewport(projectPath)
              .then((viewport) => {
                if (
                  (shared.activePath ?? shared.workspace?.path) === projectPath
                ) {
                  void flow.setViewport({
                    x: viewport.x,
                    y: viewport.y,
                    zoom: viewport.zoom,
                  });
                }
              })
              .catch((cause) => {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Could not restore this project’s canvas view.",
                );
              });
          }}
          onMoveEnd={(_event, viewport) => {
            if (!viewportProjectPath || !backendAvailable) return;
            const projectPath = viewportProjectPath;
            const payload = JSON.stringify(viewport);
            if (payload === lastSavedViewport.current) return;
            lastSavedViewport.current = payload;
            if (viewportSaveTimer.current !== null)
              window.clearTimeout(viewportSaveTimer.current);
            viewportSaveTimer.current = window.setTimeout(() => {
              const ownerApi = projectApi(projectPath);
              void ownerApi
                .saveCanvasViewport(projectPath, viewport)
                .catch((cause) => {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not save this project’s canvas view.",
                  );
                });
              viewportSaveTimer.current = null;
            }, 250);
          }}
          onPaneClick={(event) => {
            if (
              (event.target as HTMLElement).classList.contains(
                "react-flow__pane",
              )
            )
              setSelectedId(undefined);
          }}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={0.18}
          maxZoom={1.35}
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#42382f" gap={24} size={1.15} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) =>
              node.id === selectedId ? "#a855f7" : "#f97316"
            }
          />
          <Controls showInteractive={false} />
          <Panel position="top-left" className="sp-project-panel">
            <label>
              <span>Project</span>
              <select
                value={shared.activePath ?? ""}
                onChange={(event) => void shared.useProject(event.target.value)}
              >
                {shared.projects.map((project) => (
                  <option key={project.path} value={project.path}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={() => void shared.choose()}
              aria-label="Open project"
            >
              <LuPlus />
            </button>
          </Panel>
          <Panel position="top-right" className="sp-canvas-hint">
            Drag teams · Scroll to zoom · Click a worker to open
          </Panel>
          <Panel
            position="bottom-center"
            className="sp-bottom"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sp-actions">
              <button
                onClick={() => {
                  setDraftLocation(
                    canvasFlow.current?.screenToFlowPosition({
                      x: window.innerWidth / 2 - 250,
                      y: window.innerHeight / 2 - 150,
                    }) ?? null,
                  );
                  setTeamDialog(true);
                }}
              >
                <LuPlus /> New team
              </button>
              <button onClick={() => setPresetsOpen((value) => !value)}>
                Presets
              </button>
              <button
                disabled={
                  !selected ||
                  selected.tasks.length >= 12 ||
                  busy ||
                  selected.plan?.status !== "approved"
                }
                onClick={() => setWorkerDialog(true)}
              >
                <LuUsers /> Spawn agent
              </button>
              {selected?.team.state === "ready" &&
                selected.plan?.status === "approved" && (
                  <button
                    onClick={() =>
                      void api
                        .launchSpatialTeam(selected.team.id)
                        .then(async () => {
                          await shared.refresh();
                          await loadTeams();
                        })
                        .catch((cause) => setError(String(cause)))
                    }
                  >
                    Run team
                  </button>
                )}
              <button
                disabled={!selectedWorkers.length}
                onClick={() => setGroupDialog(true)}
              >
                Group ({selectedWorkers.length})
              </button>
              <button
                disabled={!selected}
                onClick={() =>
                  selected &&
                  void (
                    selected.team.state === "paused"
                      ? api.resumeSpatialTeam(selected.team.id)
                      : api.pauseSpatialTeam(selected.team.id)
                  ).then(loadTeams)
                }
              >
                {selected?.team.state === "paused" ? <LuPlay /> : <LuPause />}{" "}
                {selected?.team.state === "paused" ? "Resume" : "Pause"}
              </button>
              <button onClick={() => void openFiles()}>
                <LuFile /> Files
              </button>
              <button
                disabled={!shared.workspace}
                onClick={() =>
                  void api
                    .projectMemory(shared.workspace!.path)
                    .then((result) =>
                      setMemory(
                        result.text ||
                          "No reviewed project memory yet. Completed teams can propose reusable skills.",
                      ),
                    )
                    .catch((cause) => setError(String(cause)))
                }
              >
                <LuMemoryStick /> Memory
              </button>
              <button onClick={() => setSkillsOpen((value) => !value)}>
                <LuSparkles /> Skills
              </button>
              <button
                disabled={
                  !selected ||
                  !selected.tasks.length ||
                  !selected.tasks.every((task) => task.status === "done")
                }
                onClick={() => void openMergeReview()}
              >
                Review merge
              </button>
            </div>
            <div className="sp-command">
              <VoiceInput onTranscript={setCommand} />
              <select
                className="sp-command-target"
                value={commandTarget}
                onChange={(event) => setCommandTarget(event.target.value)}
                disabled={!selected}
                aria-label="Command target"
              >
                <option value="orchestrator">Orchestrator</option>
                {selected?.tasks
                  .filter((task) => task.session_id)
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
              </select>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void sendCommand();
                }}
                placeholder={
                  selected
                    ? `Direct ${commandTarget === "orchestrator" ? `${selected.team.name}'s orchestrator` : "selected worker"}…`
                    : "Select a team to direct…"
                }
                disabled={!selected}
              />
              <button
                className="sp-send"
                disabled={!selected || !command.trim()}
                onClick={() => void sendCommand()}
              >
                <LuSend />
              </button>
            </div>
          </Panel>
        </ReactFlow>
      )}

      {error && (
        <div className="sp-error" role="alert">
          {error}
          <button onClick={() => setError(null)}>
            <LuX />
          </button>
        </div>
      )}
      {memory !== null && (
        <aside className="sp-float">
          <header>
            <h2>Project memory</h2>
            <button onClick={() => setMemory(null)} aria-label="Close memory">
              <LuX />
            </button>
          </header>
          <pre style={{ whiteSpace: "pre-wrap" }}>{memory}</pre>
        </aside>
      )}
      {workerDialog && selected && (
        <div className="sp-modal-backdrop">
          <form
            className="sp-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void spawnAgent();
            }}
          >
            <header>
              <h2>Spawn worker</h2>
              <button
                type="button"
                aria-label="Cancel new worker"
                onClick={() => setWorkerDialog(false)}
              >
                <LuX />
              </button>
            </header>
            <label>
              Worker name
              <input
                value={workerName}
                onChange={(event) => setWorkerName(event.target.value)}
                required
              />
            </label>
            <label>
              Task instructions
              <textarea
                value={workerBrief}
                onChange={(event) => setWorkerBrief(event.target.value)}
                required
              />
            </label>
            <label>
              Owned file patterns, comma separated
              <input
                value={workerScope}
                onChange={(event) => setWorkerScope(event.target.value)}
                required
                placeholder="src/api/**, tests/api/**"
              />
            </label>
            <button className="sp-primary" disabled={busy}>
              Create worker
            </button>
          </form>
        </div>
      )}
      {groupDialog && shared.workspace && (
        <div className="sp-modal-backdrop">
          <form
            className="sp-modal"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              void api
                .groupCanvasWorkers(
                  shared.workspace!.path,
                  groupName,
                  selectedWorkers,
                )
                .then(async (result) => {
                  setSelectedWorkers([]);
                  setSelectedId(result.team.id);
                  setGroupDialog(false);
                  await loadTeams();
                })
                .catch((cause) => setError(String(cause)))
                .finally(() => setBusy(false));
            }}
          >
            <header>
              <h2>Group selected workers</h2>
              <button
                type="button"
                aria-label="Cancel grouping"
                onClick={() => setGroupDialog(false)}
              >
                <LuX />
              </button>
            </header>
            <p>
              Stopped and unstarted workers can be grouped together. Include
              their dependencies so the task graph stays intact.
            </p>
            <label>
              Team name
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                required
              />
            </label>
            <button
              className="sp-primary"
              disabled={busy || selectedWorkers.length > 12}
            >
              Create group
            </button>
          </form>
        </div>
      )}
      {presetsOpen && (
        <PresetsPanel
          team={selected}
          close={() => setPresetsOpen(false)}
          load={(preset) => {
            setDraftPreset(preset);
            setName(preset.name);
            setGoal(preset.goal);
            setOrchestrator(preset.orchestrator);
            setPresetsOpen(false);
            setTeamDialog(true);
          }}
        />
      )}

      {teamDialog && (
        <div className="sp-modal-backdrop">
          <form
            className="sp-modal"
            onSubmit={(event) => {
              event.preventDefault();
              void createTeam();
            }}
          >
            <header>
              <h2>Create a team</h2>
              <button
                type="button"
                aria-label="Cancel team creation"
                onClick={() => setTeamDialog(false)}
              >
                <LuX />
              </button>
            </header>
            <label>
              Team name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label>
              Orchestrator
              <select
                value={orchestrator}
                onChange={(event) => setOrchestrator(event.target.value)}
              >
                {HARNESSES.filter((item) => item.id !== "shell").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Goal
              <textarea
                rows={4}
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                required
                placeholder="Describe the outcome this team should deliver…"
              />
            </label>
            <label>
              Optional role skills
              <select
                multiple
                aria-label="Initial team skills"
                value={draftSkills}
                onChange={(event) =>
                  setDraftSkills(
                    Array.from(
                      event.target.selectedOptions,
                      (option) => option.value,
                    ),
                  )
                }
              >
                {Object.values(SKILLS).map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="sp-primary" disabled={busy || !goal.trim()}>
              {busy ? "Creating…" : "Create and propose plan"}
            </button>
          </form>
        </div>
      )}

      {planOpen && selected && (
        <PlanReview
          name={selected.team.name}
          tasks={planTasks}
          setTasks={setPlanTasks}
          approve={() => void approvePlan()}
          close={() => setPlanOpen(false)}
          busy={busy}
        />
      )}

      {mergeOpen && selected && mergePreview && (
        <aside className="sp-float sp-merge">
          <header>
            <div>
              <small>User confirmation required</small>
              <h2>{selected.team.name} merge</h2>
            </div>
            <button onClick={() => setMergeOpen(false)}>
              <LuX />
            </button>
          </header>
          <p className="sp-merge-summary">
            {mergePreview.ready
              ? "All workers passed their gates and are ready."
              : `Still waiting on: ${mergePreview.unfinished.join(", ") || "unknown checks"}`}
          </p>
          {mergePreview.changes.map((change) => (
            <div className="sp-merge-change" key={change.title}>
              <strong>{change.title}</strong>
              <span>{change.status}</span>
              <small>
                Quality gate: {change.gate_status ?? "not configured"}
              </small>
              {!!change.conflicts?.length && (
                <small>Conflicts: {change.conflicts.join(", ")}</small>
              )}
              {!!change.uncommitted?.length && (
                <small>Commit first: {change.uncommitted.join(", ")}</small>
              )}
              {change.gate_output && (
                <details>
                  <summary>Check output</summary>
                  <pre>{change.gate_output.slice(-8000)}</pre>
                </details>
              )}
              {change.files.length ? (
                <small>
                  {change.files
                    .map((file) => `${file.status} ${file.path}`)
                    .join(" · ")}
                </small>
              ) : (
                <small>No changed files reported</small>
              )}
            </div>
          ))}
          <button
            className="sp-primary"
            disabled={busy || !mergePreview.ready}
            onClick={() => void confirmMerge()}
          >
            {busy ? "Merging…" : "Confirm merge"}
          </button>
        </aside>
      )}

      {skillsOpen && shared.workspace && (
        <SkillsPanel
          key={shared.workspace.path}
          project={shared.workspace.path}
          team={selected}
          close={() => setSkillsOpen(false)}
          refresh={loadTeams}
        />
      )}

      {filesOpen && shared.workspace && (
        <FilesPanel
          key={shared.workspace.path}
          project={shared.workspace.path}
          initialPath={jobPath}
          close={() => {
            setFilesOpen(false);
            setJobPath(undefined);
          }}
          terminal={(path) => {
            void api
              .createSession({
                name: `Inspect ${path}`,
                kind: "terminal",
                agent: "shell",
                projectPath: shared.workspace!.path,
              })
              .then(async (session) => {
                await terminalRuntime.ensure(session);
                const quoted = `'${path.replace(/'/g, `'\\''`)}'`;
                await terminalRuntime.send(session.id, `ls -lh -- ${quoted}\r`);
                await shared.refresh();
                openTerminal(session);
              })
              .catch((cause) => setError(String(cause)));
          }}
        />
      )}

      {terminalSession && (
        <div className="sp-runtime-host" data-open="true">
          <header>
            <strong>{terminalSession.name}</strong>
            <button
              aria-label="Close terminal preview"
              onClick={() => setTerminalSession(null)}
            >
              <LuX />
            </button>
          </header>
          <Suspense fallback={<p>Opening terminal…</p>}>
            <RuntimeTerminal
              key={terminalSession.id}
              sessionId={terminalSession.id}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
