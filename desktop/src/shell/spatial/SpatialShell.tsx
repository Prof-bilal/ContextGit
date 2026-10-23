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
  type CSSProperties,
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  LuPlus,
  LuPlay,
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
import { TeamCreateDialog, TEAM_CLIS } from "./TeamCreateDialog";
import { harnessFor } from "@/shared/harnesses";
import { SKILLS } from "@/shared/roles";
import { terminalRuntime } from "../terminal/runtime";
import EmbeddedTerminal from "../terminal/EmbeddedTerminal";
import { AgentMark } from "../primitives";
import { useWorkbenchState } from "../useWorkbenchState";
import SkillsPanel from "./SkillsPanel";
import AgentPicker from "./AgentPicker";
import ProjectMenu from "./ProjectMenu";
import PlanReview from "./PlanReview";
import FilesPanel from "./FilesPanel";
import PresetsPanel, { type TeamPreset } from "./PresetsPanel";
import { RunSkills, AgentSkills, type RunSkill } from "./RunSkills";
import { useCanvasPreference } from "./useCanvasPreference";

const RuntimeTerminal = lazy(() => import("../terminal/RuntimeTerminal"));

type TeamNodeData = {
  batchId?: string;
  batchName?: string;
  batchSessionIds?: string[];
  team: SpatialTeam;
  sessions: Session[];
  taskId?: string;
  selected: boolean;
  activeSessionId?: string | null;
  attachedIds?: string[];
  onAttach?: (session: Session) => void;
  showAll?: boolean;
  onShowAll?: (teamId: string) => void;
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
  onClose: (team: SpatialTeam) => void;
  onCloseAgent: (session: Session) => void;
  onReview: (team: SpatialTeam) => void;
  onMerge: (team: SpatialTeam) => void;
  onAddWorker: (team: SpatialTeam) => void;
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

function projectLabel(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function canvasTeamId(team: SpatialTeam) {
  return `team:${encodeURIComponent(team.team.project_path)}:${team.team.id}`;
}

function canvasAgentId(team: SpatialTeam, taskId: string) {
  return `agent:${encodeURIComponent(team.team.project_path)}:${taskId}`;
}

function agentPositionKey(projectPath: string, sessionId: string) {
  return `contextgit:canvas-agent-position:v3:${projectPath}:${sessionId}`;
}

function savedAgentPosition(projectPath: string, sessionId: string) {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(agentPositionKey(projectPath, sessionId)) ??
        "null",
    );
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
      return { x: value.x as number, y: value.y as number };
    }
  } catch {
    // Ignore stale canvas state and use the generated position.
  }
  return undefined;
}

function saveAgentLayout(
  projectPath: string,
  sessionId: string,
  layout: { width?: number; height?: number; x?: number; y?: number },
) {
  const key = agentPositionKey(projectPath, sessionId);
  let current: Record<string, number> = {};
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (value && typeof value === "object") current = value;
  } catch {
    // Replace invalid canvas state with the new dimensions.
  }
  window.localStorage.setItem(key, JSON.stringify({ ...current, ...layout }));
}

const TeamNode = memo(function TeamNode({ data }: NodeProps<Node<TeamNodeData>>) {
  const { team, sessions } = data;
  const collapsed = team.layout.collapsed;
  const standalone = team.team.name === "Ungrouped runs";
  const parent = sessions.find(session => session.id === team.team.orchestrator_session_id);
  const visibleTasks = team.tasks.filter(
    (task) =>
      !task.session_id ||
      sessions.some((session) => session.id === task.session_id),
  );
  // Keep larger teams manageable; every visible started worker has a live xterm.
  const capped = data.showAll ? visibleTasks : visibleTasks.slice(0, 6);
  const workers = standalone ? capped.slice().reverse() : capped;
  const hiddenCount = visibleTasks.length - capped.length;
  const columns = Math.max(1, Math.min(3, workers.length));
  return (
    <section
      className="sp-team nopan"
      data-standalone={standalone}
      data-selected={data.selected}
      data-state={team.team.state}
      onPointerDown={() => data.onSelect(team.team.id)}
    >
      <NodeResizer
        isVisible={!standalone && data.selected && !collapsed}
        minWidth={860}
        minHeight={480}
        maxWidth={2400}
        maxHeight={1800}
        onResizeEnd={(_event, params) =>
          data.onResize(team, params.width, params.height, {
            x: params.x,
            y: params.y,
          })
        }
      />
      {!standalone && <header className="sp-team-head">
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
          {workers.length} agents
        </span>
        <button className="sp-icon nodrag" aria-label={`Review ${team.team.name} plan`} title="Review plan" onClick={() => data.onReview(team)}><LuFile /></button>
        <button className="sp-icon nodrag" aria-label={`Add worker to ${team.team.name}`} title="Propose worker for approval" onClick={() => data.onAddWorker(team)}><LuPlus /></button>
        <button className="sp-icon nodrag" aria-label={team.team.state === "paused" ? "Resume team" : "Pause team"} title={team.team.state === "paused" ? "Resume team" : "Pause team"} onClick={() => data.onPause(team)}>{team.team.state === "paused" ? <LuPlay /> : <LuPause />}</button>
        <button className="sp-icon nodrag" aria-label="Review final team merge" title="Review final merge" onClick={() => data.onMerge(team)}><LuUsers /></button>
        <button
          className="sp-icon nodrag"
          onClick={() => data.onToggle(team)}
          aria-label={collapsed ? "Expand team" : "Collapse team"}
        >
          {collapsed ? <LuChevronDown /> : <LuChevronUp />}
        </button>
        <button
          className="sp-icon nodrag sp-team-close"
          title="Close team"
          aria-label="Close team"
          onClick={() => data.onClose(team)}
        >
          <LuX />
        </button>
      </header>}
      {!collapsed && (
        <div className="sp-team-body">
          {!standalone && parent && <div className="sp-team-parent nodrag">
            <header className="sp-worker-head"><AgentMark agent={parent.agent ?? "codex"} label="P" /><strong>Parent · {harnessFor(parent.agent)?.label ?? parent.agent}</strong><small title={parent.model ?? "CLI default"}>{parent.model ?? "CLI default"} · {team.team.state}</small><button className="sp-icon" aria-label="Resume parent terminal" title="Resume parent terminal" onClick={() => data.onOpen(parent)}><LuPlay /></button></header>
            <EmbeddedTerminal sessionId={parent.id} onResume={() => data.onOpen(parent)} />
            <AgentSkills skills={parent.skills ?? []} />
          </div>}
          {!standalone && team.execution && <div className="sp-team-runtime-info"><span>{team.execution.integration_branch}</span><small>{team.execution.max_active} active workers max · Separate worktrees</small>{team.integrations?.filter(item => item.status === "blocked").map(item => <p role="alert" key={item.task_id}>{item.error}</p>)}</div>}
          <div
            className="sp-workers nodrag"
            data-count={workers.length}
            style={
              standalone
                ? {
                    gridTemplateColumns: `repeat(${columns}, minmax(420px, 1fr))`,
                  }
                : undefined
            }
          >
            {workers.length === 0 && (
              <div className="sp-empty-team">
                <LuBot />
                <strong>No agents yet</strong>
                <span>Use the chat bar below to start an AI agent.</span>
              </div>
            )}
            {workers.map((task) => {
              const session = workerSession(team, task.id, sessions);
              return (
                <div
                  key={task.id}
                  className="sp-worker"
                  role="button"
                  tabIndex={0}
                  data-status={task.status}
                  aria-pressed={data.selectedWorkers.includes(task.id)}
                  title={
                    standalone
                      ? undefined
                      : "Click to inspect; Shift+click to select for grouping. Drag to reorder."
                  }
                  draggable={!standalone}
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
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && session) data.onOpen(session);
                  }}
                >
                  <span className="sp-worker-head">
                    <span className="sp-agent-pixel">✣</span>
                    <strong>
                      {session
                        ? `${harnessFor(session.agent)?.label ?? session.agent ?? "Agent"} · ${task.title.replace(/^Agent · /, "")}`
                        : task.title}
                    </strong>
                    <em>{task.status}</em>
                    {standalone && session && (
                      <button
                        type="button"
                        className="sp-agent-close nodrag"
                        aria-label={`Close ${session.name}`}
                        title="Close agent"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          data.onCloseAgent(session);
                        }}
                      >
                        <LuX />
                      </button>
                    )}
                  </span>
                  <span className="sp-worker-meta">
                    {task.agent ?? "unassigned"} · {task.role}
                  </span>
                  {session ? (
                    <><EmbeddedTerminal sessionId={session.id} onResume={() => data.onOpen(session)} /><AgentSkills skills={session.skills ?? []} /></>
                  ) : (
                    <code>
                      &gt; {task.brief || task.title}
                      <br />› {task.status}
                    </code>
                  )}
                </div>
              );
            })}
            {hiddenCount > 0 && (
              <button
                type="button"
                className="sp-show-all nodrag"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onShowAll?.(team.team.id);
                }}
              >
                Show all {visibleTasks.length} agent terminals ({hiddenCount} hidden)
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
});

const AgentNode = memo(function AgentNode({ data }: NodeProps<Node<TeamNodeData>>) {
  const task = data.team.tasks.find((entry) => entry.id === data.taskId);
  const session = task
    ? workerSession(data.team, task.id, data.sessions)
    : undefined;
  if (!task || !session) return null;

  const projectPath = data.team.team.project_path;

  return (
    <section
      className="sp-worker sp-agent-node nopan"
      data-status={task.status}
      data-selected={data.selected}
      onPointerDown={() => data.onSelect(data.team.team.id)}
      onClick={() => data.onOpen(session)}
    >
      <NodeResizer
        isVisible={data.selected}
        color="#a77b60"
        lineStyle={{ borderWidth: 1 }}
        handleStyle={{ width: 7, height: 7, borderRadius: 2 }}
        minWidth={430}
        minHeight={360}
        maxWidth={1500}
        maxHeight={1200}
        onResizeEnd={(_event, params) =>
          saveAgentLayout(projectPath, session.id, {
            width: params.width,
            height: params.height,
          })
        }
      />
      <header className="sp-worker-head">
        <AgentMark agent={session.agent ?? "shell"} label={harnessFor(session.agent)?.monogram ?? "$"} />
        <span className="sp-agent-project" title={projectPath}>
          {projectLabel(projectPath)}
        </span>
        <strong>
          {session.name.replace(/^Agent · /, "")}
        </strong>
        <em>{task.status}</em>
        <button
          type="button"
          className="sp-agent-close nodrag"
          aria-label={`Close ${session.name}`}
          title="Close agent"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onCloseAgent(session);
          }}
        >
          <LuX />
        </button>
      </header>
      <EmbeddedTerminal sessionId={session.id} onResume={() => data.onOpen(session)} />
      <AgentSkills skills={session.skills ?? []} />
    </section>
  );
});

const BatchNode = memo(function BatchNode({ data }: NodeProps<Node<TeamNodeData>>) {
  const sessions = data.batchSessionIds?.flatMap(id => data.sessions.filter(session => session.id === id)) ?? [];
  return <section className="sp-batch nopan" aria-label={data.batchName}>
    <NodeResizer isVisible={data.selected} minWidth={880} minHeight={400}
      color="#9d603e" onResizeEnd={(_event, params) => saveAgentLayout(data.team.team.project_path, data.batchId!, {width:params.width,height:params.height})} />
    <header className="sp-batch-head"><LuGrip /><strong>{data.batchName}</strong><span>{sessions.length} agents</span></header>
    <div className="sp-batch-grid nodrag" style={{gridTemplateColumns:`repeat(${Math.min(2, sessions.length)}, minmax(0, 1fr))`}}>
      {sessions.map(session => <section className="sp-batch-terminal" key={session.id}>
        <header><AgentMark agent={session.agent ?? "shell"} label={harnessFor(session.agent)?.monogram ?? "$"} />
          <strong>{session.name}</strong><span>{session.status}</span>
          <button className="sp-agent-close" aria-label={`Close ${session.name}`} onClick={() => data.onCloseAgent(session)}><LuX /></button>
        </header>
        <EmbeddedTerminal sessionId={session.id} onResume={() => data.onOpen(session)} />
        <AgentSkills skills={session.skills ?? []} />
      </section>)}
    </div>
  </section>;
});

type CanvasBatch = {id:string; name:string; projectPath:string; sessionIds:string[]};
const BATCH_STORAGE = "contextgit:canvas-batches:v1";
const nodeTypes = { team: TeamNode, agent: AgentNode, batch: BatchNode };

export default function SpatialShell({
  backendAvailable = true,
}: {
  backendAvailable?: boolean;
}) {
  const shared = useWorkbenchState();
  const [teams, setTeams] = useState<SpatialTeam[]>([]);
  const [batches, setBatches] = useState<CanvasBatch[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(BATCH_STORAGE) ?? "[]");
      return Array.isArray(stored) ? stored.filter(batch => typeof batch.id === "string" && typeof batch.name === "string" && typeof batch.projectPath === "string" && Array.isArray(batch.sessionIds)) : [];
    } catch { return []; }
  });
  useEffect(() => { localStorage.setItem(BATCH_STORAGE, JSON.stringify(batches)); }, [batches]);
  const [nodes, setNodes] = useState<Node<TeamNodeData>[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [closedAgentIds, setClosedAgentIds] = useState<string[]>([]);
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [showAllTeams, setShowAllTeams] = useState<Record<string, boolean>>({});
  const [flowVersion, setFlowVersion] = useState(0);
  const [teamDialog, setTeamDialog] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [planOwnerId, setPlanOwnerId] = useState<string>();
  const [mergeOwnerId, setMergeOwnerId] = useState<string>();
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
  const [orchestrator, setOrchestrator] = useCanvasPreference<string>(undefined, "agent-cli", "codex");
  const [planTasks, setPlanTasks] = useState<TeamPlanTask[]>([]);
  const [commandProjectPath, setCommandProjectPath] = useState(
    shared.workspace?.path ?? "",
  );
  const [spawnCount, setSpawnCount] = useState(1);
  const [spawnProgress, setSpawnProgress] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [armedTeamIds, setArmedTeamIds] = useState<string[]>([]);
  const notifiedParentEvents = useRef(new Set<string>());
  const [maxTeamActive, setMaxTeamActive] = useState(4);
  const [teamModels, setTeamModels] = useState<Record<string, string>>({});
  const [workerModels, setWorkerModels] = useState<Record<string, string>>({});
  const [allowedTeamAgents, setAllowedTeamAgents] = useState(["codex", "claude"]);
  const [installedTeamAgents, setInstalledTeamAgents] = useState<string[]>([]);
  const [checkingTeamAgents, setCheckingTeamAgents] = useState(false);
  const [teamSkills, setTeamSkills] = useState<RunSkill[]>([]);
  useEffect(() => {
    if (!teamDialog) return;
    let active = true;
    setCheckingTeamAgents(true);
    void Promise.all(TEAM_CLIS.map(async agent => ({ agent, installed: (await window.contextgit?.harnessCheck(agent))?.installed ?? false })))
      .then(results => {
        if (!active) return;
        const installed = results.filter(result => result.installed).map(result => result.agent);
        setInstalledTeamAgents(installed);
        setAllowedTeamAgents(installed);
        if (installed.length && !installed.includes(orchestrator)) setOrchestrator(installed[0]);
      }).catch(cause => { if (active) setError(String(cause)); })
      .finally(() => { if (active) setCheckingTeamAgents(false); });
    return () => { active = false; };
  }, [teamDialog]);
  const [runSkills, setRunSkills] = useState<RunSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [worktreeMode, setWorktreeMode] = useState<"root" | "worktree">("root");
  const [agentCount, setAgentCount] = useState(4);
  const [teamRoles, setTeamRoles] = useState(
    "frontend, backend, tests, review",
  );
  const [workerAgents, setWorkerAgents] = useState<string[]>([
    "claude",
    "codex",
    "claude",
    "codex",
  ]);
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
    setCenter: (
      x: number,
      y: number,
      options?: { zoom?: number; duration?: number },
    ) => Promise<boolean>;
  } | null>(null);
  const centeredAgents = useRef<string | null>(null);
  const [draftLocation, setDraftLocation] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const currentProject = useRef(shared.workspace?.path);
  currentProject.current = shared.workspace?.path;

  useEffect(() => {
    if (!commandProjectPath && shared.workspace?.path)
      setCommandProjectPath(shared.workspace.path);
  }, [commandProjectPath, shared.workspace?.path]);

  useEffect(() => {
    const path = shared.workspace?.path;
    if (!path) {
      setClosedAgentIds([]);
      return;
    }
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(`contextgit:closed-canvas-agents:${path}`) ??
          "[]",
      );
      setClosedAgentIds(Array.isArray(stored) ? stored : []);
    } catch {
      setClosedAgentIds([]);
    }
  }, [shared.workspace?.path]);

  const api = useMemo(
    () => projectApi(shared.workspace?.path),
    [shared.workspace?.path],
  );
  const loadTeams = useCallback(async () => {
    if (!shared.workspace || !backendAvailable) {
      setTeams([]);
      return;
    }
    try {
      const paths = [
        ...new Set([
          shared.workspace.path,
          ...shared.projects.map((project) => project.path),
        ]),
      ];
      const results = await Promise.allSettled(
        paths.map((path) => projectApi(path).teams(path)),
      );
      const next = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      const failed = results.find((result) => result.status === "rejected");
      setTeams(next);
      setError(
        failed?.status === "rejected"
          ? "Some projects could not be loaded. Their agents will appear when the project backend reconnects."
          : null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load teams");
    }
  }, [backendAvailable, shared.projects, shared.workspace?.path]);

  useEffect(() => {
    void loadTeams();
    // Back off while the tab is hidden so background polling doesn't churn
    // the canvas and the backend.
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          void loadTeams();
          schedule();
        },
        document.hidden ? 12000 : 6000,
      );
    };
    schedule();
    const onVisibility = () => {
      if (!document.hidden) void loadTeams();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadTeams]);

  useEffect(() => {
    if (!backendAvailable || !shared.workspace) return;
    const paths = [
      ...new Set([
        shared.workspace.path,
        ...shared.projects.map((project) => project.path),
      ]),
    ].filter((path) => !migratedProjects.current.has(path));
    if (!paths.length) return;
    paths.forEach((path) => migratedProjects.current.add(path));
    void Promise.all(
      paths.map((path) => projectApi(path).importCanvasSessions(path)),
    )
      .then(loadTeams)
      .catch((cause) => {
        paths.forEach((path) => migratedProjects.current.delete(path));
        setError(String(cause));
      });
  }, [backendAvailable, loadTeams, shared.projects, shared.workspace]);

  const focusAgentNode = useCallback((sessionId: string) => {
    const flow = canvasFlow.current;
    if (!flow) return;
    setNodes((current) => {
      const target = current.find(
        (node) =>
          (node.type === "batch" && node.data.batchSessionIds?.includes(sessionId)) ||
          (node.type === "agent" &&
            node.data.team.tasks.some((task) => task.session_id === sessionId)) ||
          (node.type === "team" &&
            node.data.team.tasks.some((task) => task.session_id === sessionId)),
      );
      if (target)
        window.requestAnimationFrame(() => {
          const width = Number(target.style?.width) || 760;
          const height = Number(target.style?.height) || 520;
          void flow
            .setCenter(target.position.x + width / 2, target.position.y + height / 2, {
              zoom: Math.min(0.95, (window.innerWidth - 100) / width, (window.innerHeight - 180) / height),
              duration: 250,
            })
            .catch(() => {});
        });
      return current;
    });
  }, []);

  const openTerminal = useCallback(
    (session: Session) => {
      shared.openSession(session);
      shared.setActiveId(session.id);
      setSelectedId((current) => {
        const owner = teams.find(
          (team) =>
            team.team.orchestrator_session_id === session.id ||
            team.tasks.some((task) => task.session_id === session.id),
        );
        return owner?.team.id ?? current;
      });
      // Attaching mounts the live xterm for this card and keeps the tab strip
      // in sync with the shared active session.
      setAttachedIds((current) =>
        current.includes(session.id) ? current : [...current, session.id],
      );
      // An inline terminal already owns this PTY's grid. Mounting a second
      // preview with a different size makes the two views resize each other.
      const inline = teams.some(team => team.team.orchestrator_session_id === session.id || team.tasks.some(task => task.session_id === session.id));
      setTerminalSession(inline ? null : session);
      focusAgentNode(session.id);
      const owner = teams.find(
        (team) =>
          team.team.orchestrator_session_id === session.id ||
          team.tasks.some((task) => task.session_id === session.id),
      );
      const task = owner?.tasks.find((task) => task.session_id === session.id);
      if (owner?.execution) setArmedTeamIds(current => current.includes(owner.team.id) ? current : [...current, owner.team.id]);
      if (terminalRuntime.session(session.id)) {
        if (["idle", "exited", "error"].includes(terminalRuntime.snapshot(session.id).state))
          void terminalRuntime.retry(session.id, owner?.team.id, task?.id).catch(cause => setError(String(cause)));
        return;
      }
      const ownerApi = owner ? projectApi(owner.team.project_path) : api;
      const start =
        task && ["todo", "blocked"].includes(task.status)
          ? ownerApi.startSpatialTask(owner!.team.id, task.id).then(() => {})
          : Promise.resolve();
      void start
        .then(() => terminalRuntime.ensure(session, owner?.team.id, task?.id))
        .catch((cause) => setError(String(cause)));
    },
    [api, teams, shared.openSession, shared.setActiveId, focusAgentNode],
  );

  useEffect(() => {
    const projectPaths = [
      ...new Set(teams.map((entry) => entry.team.project_path)),
    ];
    setNodes((current) =>
      teams
        .flatMap<Node<TeamNodeData>>((team) => {
          const projectOffset = Math.max(
            0,
            projectPaths.indexOf(team.team.project_path),
          ) * 900;
          const teamNodeId = canvasTeamId(team);
          const old = current.find((node) => node.id === teamNodeId);
          const standalone = team.team.name === "Ungrouped runs";
          const visibleSessions = shared.sessions.filter(
            (session) => !closedAgentIds.includes(session.id),
          );
          const baseNode = {
            ...old,
            id: teamNodeId,
            type: "team",
            position:
              old?.position ?? {
                x: team.layout.x + projectOffset,
                y: team.layout.y,
              },
            data: {
              team,
              sessions: visibleSessions,
              selected:
                selectedId === team.team.id ||
                (shared.activeId != null &&
                  team.tasks.some(
                    (task) => task.session_id === shared.activeId,
                  )),
              activeSessionId: shared.activeId,
              attachedIds,
              onAttach: openTerminal,
              showAll: showAllTeams[team.team.id] ?? false,
              onShowAll: (teamId: string) =>
                setShowAllTeams((current) => ({
                  ...current,
                  [teamId]: !(current[teamId] ?? false),
                })),
              onSelect: setSelectedId,
              onOpen: openTerminal,
              onToggle: async (entry: SpatialTeam) => {
                await projectApi(entry.team.project_path).updateTeamLayout(entry.team.id, {
                  ...entry.layout,
                  collapsed: !entry.layout.collapsed,
                });
                await loadTeams();
              },
              onPause: async (entry: SpatialTeam) => {
                const ownerApi = projectApi(entry.team.project_path);
                if (entry.team.state === "paused")
                  await ownerApi.resumeSpatialTeam(entry.team.id);
                else await ownerApi.pauseSpatialTeam(entry.team.id);
                if (entry.team.state === "paused") {
                  setArmedTeamIds(current => current.includes(entry.team.id) ? current : [...current, entry.team.id]);
                  await shared.refresh();
                }
                await loadTeams();
              },
              onReview: (entry: SpatialTeam) => {
                setSelectedId(entry.team.id);
                setPlanOwnerId(entry.team.id);
                setPlanTasks(entry.plan?.plan.tasks ?? []);
                setPlanOpen(true);
              },
              onAddWorker: (entry: SpatialTeam) => {
                setSelectedId(entry.team.id);
                setPlanOwnerId(entry.team.id);
                setPlanTasks([...(entry.plan?.plan.tasks ?? []), { id: `worker-${crypto.randomUUID().slice(0, 8)}`, title: "New worker", agent: entry.execution?.allowed_agents[0] ?? "codex", role: "implementer", brief: "", scope: [], depends_on: [], done_criteria: "" }]);
                setPlanOpen(true);
              },
              onMerge: (entry: SpatialTeam) => {
                setSelectedId(entry.team.id);
                setMergeOwnerId(entry.team.id);
                void projectApi(entry.team.project_path).previewSpatialTeamMerge(entry.team.id).then(result => { setMergePreview(result); setMergeOpen(true); }).catch(cause => setError(String(cause)));
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
                void projectApi(entry.team.project_path)
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
                void projectApi(entry.team.project_path)
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
              onClose: (entry: SpatialTeam) => {
                if (
                  !window.confirm(
                    `Close ${entry.team.name}? Its history will be archived and kept.`,
                  )
                )
                  return;
                void projectApi(entry.team.project_path)
                  .archiveSpatialTeam(entry.team.id)
                  .then(async () => {
                    if (selectedId === entry.team.id) setSelectedId(undefined);
                    await loadTeams();
                  })
                  .catch((cause) => setError(String(cause)));
              },
              onCloseAgent: (session: Session) => {
                setAttachedIds((current) =>
                  current.filter((id) => id !== session.id),
                );
                shared.setActiveId((current) =>
                  current === session.id ? null : current,
                );
                if (terminalSession?.id === session.id) setTerminalSession(null);
                setClosedAgentIds((current) => {
                  const next = current.includes(session.id)
                    ? current
                    : [...current, session.id];
                  const path = shared.workspace?.path;
                  if (path)
                    window.localStorage.setItem(
                      `contextgit:closed-canvas-agents:${path}`,
                      JSON.stringify(next),
                    );
                  return next;
                });
                void terminalRuntime
                  .stop(session.id)
                  .catch((cause) => setError(String(cause)));
              },
            },
            draggable: true,
            dragHandle: ".sp-team-head",
            selectable: true,
            style: {
              // Floor the width so the auto-fill grid never squeezes 400px
              // cards into clipped "boxes".
              width: team.layout.collapsed
                ? 520
                : Math.max(team.layout.width || 0, standalone ? 0 : 880),
              zIndex:
                selectedId === team.team.id
                  ? team.layout.z_index + 100
                  : team.layout.z_index,
            },
          } satisfies Node<TeamNodeData>;

          if (!standalone) return [baseNode];

          const visibleTasks = team.tasks
            .filter(
              (task) =>
                Boolean(task.session_id) &&
                visibleSessions.some(
                  (session) => session.id === task.session_id,
                ),
            )
            .slice()
            .reverse();

          const projectBatches = batches.filter(batch => batch.projectPath === team.team.project_path);
          const batchNodes = projectBatches.flatMap((batch, index) => {
            const ids = batch.sessionIds.filter(id => visibleTasks.some(task => task.session_id === id));
            if (!ids.length) return [];
            const previous = current.find(node => node.id === batch.id);
            const layout = (() => { try { return JSON.parse(localStorage.getItem(agentPositionKey(batch.projectPath, batch.id)) ?? "{}"); } catch { return {}; } })();
            return [{
              id: batch.id, type: "batch",
              position: previous?.position ?? {x:layout.x ?? team.layout.x + projectOffset, y:layout.y ?? team.layout.y + index * 1040},
              data: {...baseNode.data, batchId:batch.id, batchName:batch.name, batchSessionIds:ids},
              draggable:true, dragHandle:".sp-batch-head",
              style:{width:layout.width ?? 1320, height:layout.height ?? 48 + Math.ceil(ids.length / 2) * 450},
            } satisfies Node<TeamNodeData>];
          });
          const batchedIds = new Set(projectBatches.flatMap(batch => batch.sessionIds));
          return [...batchNodes, ...visibleTasks.filter(task => !batchedIds.has(task.session_id!)).map((task, index) => {
            const session = visibleSessions.find(
              (entry) => entry.id === task.session_id,
            )!;
            const id = canvasAgentId(team, task.id);
            const oldAgent = current.find((node) => node.id === id);
            const stored = shared.workspace?.path
              ? savedAgentPosition(shared.workspace.path, session.id)
              : undefined;
            const storedSize = shared.workspace?.path
              ? (() => {
                  try {
                    const value = JSON.parse(
                      window.localStorage.getItem(
                        agentPositionKey(shared.workspace.path, session.id),
                      ) ?? "null",
                    );
                    return {
                      width:
                        Number.isFinite(value?.width) && value.width >= 430
                          ? value.width
                          : 760,
                      height:
                        Number.isFinite(value?.height) && value.height >= 360
                          ? value.height
                          : 520,
                    };
                  } catch {
                    return { width: 760, height: 520 };
                  }
                })()
              : { width: 760, height: 520 };
            return {
              ...oldAgent,
              id,
              type: "agent",
              position:
                oldAgent?.position ??
                stored ?? {
                  x: team.layout.x + projectOffset + (index % 3) * 800,
                  y: team.layout.y + Math.floor(index / 3) * 570,
                },
              data: {
                ...baseNode.data,
                taskId: task.id,
                selected: selectedId === team.team.id,
              },
              draggable: true,
              dragHandle: ".sp-worker-head",
              selectable: true,
              style: {
                width: storedSize.width,
                height: storedSize.height,
                zIndex: team.layout.z_index + index,
              },
            } satisfies Node<TeamNodeData>;
          })];
        }),
    );
  }, [
    api,
    loadTeams,
    openTerminal,
    selectedId,
    selectedWorkers,
    closedAgentIds,
    attachedIds,
    showAllTeams,
    shared.sessions,
    shared.activeId,
    shared.workspace?.path,
    teams,
    batches,
  ]);

  const selected =
    teams.find(
      (team) => team.team.id === selectedId,
    ) ?? null;
  const planTeam = teams.find(team => team.team.id === planOwnerId) ?? selected;
  const mergeTeam = teams.find(team => team.team.id === mergeOwnerId) ?? selected;
  // Canvas tab strip: every visible agent session, synced with the shared
  // active session so canvas clicks and tab clicks select the same run.
  const canvasTabs = useMemo(() => {
    const seen = new Set<string>();
    return teams
      .flatMap((team) =>
        team.tasks.flatMap((task) =>
          task.session_id ? [{ team, task }] : [],
        ),
      )
      .map(({ team, task }) => ({
        team,
        task,
        session: shared.sessions.find(
          (entry) => entry.id === task.session_id,
        ),
      }))
      .filter(
        (entry): entry is { team: SpatialTeam; task: (typeof entry.task); session: Session } =>
          Boolean(entry.session) &&
          !closedAgentIds.includes(entry.session!.id) &&
          !seen.has(entry.session!.id) &&
          Boolean(seen.add(entry.session!.id)),
      )
      .slice(0, 24);
  }, [teams, shared.sessions, closedAgentIds]);
  useEffect(() => {
    setMergeOpen(false);
  }, [selectedId]);
  const viewportProjectPath = shared.workspace?.path;
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
    centeredAgents.current = null;
    setFlowVersion((version) => version + 1);
  }, [viewportProjectPath]);

  useEffect(() => {
    const flow = canvasFlow.current;
    if (!flow || !viewportProjectPath || nodes.length === 0) return;
    const focus = nodes.find((node) => node.type === "agent") ?? nodes[0];
    const agentCount = nodes.filter((node) => node.type === "agent").length;
    if (focus.type === "team" && !focus.measured?.height) return;
    const signature = `${viewportProjectPath}:${focus.id}:${agentCount}:${focus.type === "team" ? focus.data.team.tasks.filter(task => task.session_id).length : ""}`;
    if (centeredAgents.current === signature) return;
    centeredAgents.current = signature;
    window.requestAnimationFrame(() => {
      const width = Number(focus.style?.width) || 760;
      const height = (focus.type === "team" ? focus.measured?.height : Number(focus.style?.height)) || 520;
      void flow.setCenter(focus.position.x + width / 2, focus.position.y + height / 2, {
        zoom: Math.min(0.9, (window.innerWidth - 100) / width, (window.innerHeight - 180) / height),
        duration: 250,
      });
    });
  }, [nodes, viewportProjectPath]);

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
    // Loading saved canvas data is read-only. Only explicit launch/resume
    // actions may create a process; opening the app must not start old CLIs.
    for (const session of shared.sessions) {
      if (["done", "error"].includes(session.status) && !terminalRuntime.session(session.id))
        void terminalRuntime.restore(session);
    }
  }, [shared.sessions]);

  useEffect(() => {
    // Explicit creation/approval/resume authorizes future dependency launches.
    // Merely reopening saved teams never silently restarts their CLIs.
    for (const team of teams) {
      if (!armedTeamIds.includes(team.team.id) || team.team.state === "paused") continue;
      const parent = shared.sessions.find(item => item.id === team.team.orchestrator_session_id);
      if (parent && !["done", "error"].includes(parent.status) && !terminalRuntime.session(parent.id))
        void terminalRuntime.ensure(parent, team.team.id).catch(cause => setError(String(cause)));
      for (const task of team.tasks) {
        const session = shared.sessions.find(item => item.id === task.session_id);
        if (session && task.status === "working" && !terminalRuntime.session(session.id))
          void terminalRuntime.ensure(session, team.team.id, task.id).then(() => {
            const state = terminalRuntime.snapshot(session.id);
            if (state.state === "error") setError(state.error ?? "Worker failed to launch");
          }).catch(cause => setError(String(cause)));
      }
    }
  }, [teams, shared.sessions, armedTeamIds]);

  useEffect(() => {
    for (const team of teams) {
      const parentId = team.team.orchestrator_session_id;
      if (!team.execution || !parentId || !armedTeamIds.includes(team.team.id) || team.team.state === "paused" || terminalRuntime.snapshot(parentId).state !== "running") continue;
      const updates: Array<{ key: string; text: string }> = [];
      if (team.plan?.status === "approved") updates.push({ key: `${team.team.id}:approved:${team.plan.revision}`, text: `The user approved team plan revision ${team.plan.revision}. Coordinate the approved workers; read team_status and list_tasks.` });
      for (const task of team.tasks) if (task.status === "review") updates.push({ key: `${task.id}:review:${task.gate_ran_at ?? "submitted"}`, text: `Worker ${task.id} (${task.title}) submitted work for review. Inspect its committed diff and quality-gate evidence, then use review_task to approve or request changes.` });
      for (const message of team.messages ?? []) if (message.from_task_id && ["question", "handoff"].includes(message.kind)) updates.push({ key: `${team.team.id}:message:${message.id}`, text: `Worker message on the team board (${message.id}). Use read_board to inspect and respond.` });
      const pending = updates.filter(update => !notifiedParentEvents.current.has(update.key));
      if (!pending.length) continue;
      pending.forEach(update => notifiedParentEvents.current.add(update.key));
      void terminalRuntime.send(parentId, `${pending.map(update => update.text).join(" ")}\r`).catch(cause => {
        pending.forEach(update => notifiedParentEvents.current.delete(update.key));
        setError(String(cause));
      });
    }
  }, [teams, armedTeamIds, shared.sessions]);

  useEffect(() => {
    if (!selected?.plan || selected.plan.status !== "draft" || planOpen) return;
    if (seenPlanRevision.current[selected.team.id] === selected.plan.revision)
      return;
    const tasks = selected.plan.plan.tasks ?? [];
    if (!tasks.length) return;
    seenPlanRevision.current[selected.team.id] = selected.plan.revision;
    setPlanOwnerId(selected.team.id);
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
        const team = teams.find(
          (entry) => entry.team.id === change.id || canvasTeamId(entry) === change.id,
        );
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
      if (node.type === "batch" && node.data.batchId) {
        saveAgentLayout(node.data.team.team.project_path, node.data.batchId, node.position);
        return;
      }
      if (node.type === "agent" && node.data.taskId) {
        const task = node.data.team.tasks.find(
          (entry) => entry.id === node.data.taskId,
        );
        const projectPath = node.data.team.team.project_path;
        if (task?.session_id && projectPath) {
          window.localStorage.setItem(
            agentPositionKey(projectPath, task.session_id),
            JSON.stringify(node.position),
          );
        }
        return;
      }
      const team = teams.find(
        (entry) => entry.team.id === node.id || canvasTeamId(entry) === node.id,
      );
      if (!team) return;
      try {
        await projectApi(team.team.project_path).updateTeamLayout(team.team.id, {
          ...team.layout,
          x: node.position.x,
          y: node.position.y,
          z_index: Math.max(...teams.map((entry) => entry.layout.z_index)) + 1,
        });
      } catch (cause) {
        setError(String(cause));
      }
    },
    [api, shared.workspace?.path, teams],
  );

  const createTeam = async (requestedGoal = goal) => {
    if (!shared.workspace || !requestedGoal.trim() || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      for (const agent of [...new Set([orchestrator, ...allowedTeamAgents])]) {
        const check = await window.contextgit?.harnessCheck(agent);
        if (!check?.installed) throw new Error(`Install ${agent} or remove it from this team's allowed CLIs.`);
      }
      const created = await api.createSpatialTeam({
        name: name.trim(),
        projectPath: shared.workspace.path,
        goal: requestedGoal.trim(),
        orchestratorAgent: orchestrator,
        managedExecution: true,
        maxActive: maxTeamActive,
        allowedAgents: allowedTeamAgents,
        orchestratorModel: teamModels[orchestrator] || undefined,
        workerModels: Object.fromEntries(Object.entries(workerModels).filter(([agent, model]) => allowedTeamAgents.includes(agent) && model)),
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
      for (const skill of teamSkills) await api.attachTeamSkill(created.team.id, {
        skill_id: skill.id.includes(":") ? skill.id.slice(skill.id.indexOf(":") + 1) : skill.id,
        title: skill.title, instruction: skill.instruction, origin: skill.origin as "built-in" | "project" | "global",
      });
      const session = await api.startOrchestrator(created.team.id);
      shared.addSession(session);
      await terminalRuntime.ensure(session, created.team.id);
      if (terminalRuntime.snapshot(session.id).state === "error") throw new Error(terminalRuntime.snapshot(session.id).error ?? "Parent failed to launch");
      setArmedTeamIds(current => [...new Set([...current, created.team.id])]);
      if (draftPreset)
        await api.saveTeamPlan(created.team.id, goal.trim(), draftPreset.tasks);
      shared.openSession(session);
      setSelectedId(created.team.id);
      setTeamDialog(false);
      setName(`Team ${String(teams.length + 2).padStart(2, "0")}`);
      setGoal("");
      await loadTeams();
      setDraftPreset(null);
      setDraftSkills([]);
      setWorkerAgents(["claude", "codex", "claude", "codex"]);
      setComposerOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create team",
      );
    } finally {
      setBusy(false);
    }
  };

  const runFromComposer = async () => {
    const projectPath = commandProjectPath || shared.workspace?.path;
    if (!projectPath || busy) return;
    setBusy(true);
    setSpawnProgress(0);
    setError(null);
    let created = 0;
    const batchId = `batch-${crypto.randomUUID()}`;
    const batchName = `Batch ${String(batches.filter(batch => batch.projectPath === projectPath).length + 1).padStart(2, "0")}`;
    try {
      const targetApi = projectApi(projectPath);
      for (let index = 0; index < spawnCount; index++) {
        const session = await targetApi.createSession({
          name: `${harnessFor(orchestrator)?.label ?? orchestrator}${spawnCount > 1 ? ` · ${index + 1}` : ""}`,
          kind: "terminal",
          agent: orchestrator,
          projectPath,
          worktree: worktreeMode === "worktree",
          baseRef: worktreeMode === "worktree" ? "HEAD" : undefined,
          skills: runSkills.map(skill => skill.title),
          task: runSkills.length ? `Use these selected skills for this run:\n\n${runSkills.map(skill => `## ${skill.title}\n${skill.instruction}`).join("\n\n")}\n\nWait for the user's task before starting work.` : undefined,
        });
        shared.addSession(session);
        created++;
        if (spawnCount > 1) setBatches(current => {
          const existing = current.find(batch => batch.id === batchId);
          return existing
            ? current.map(batch => batch.id === batchId ? {...batch, sessionIds:[...batch.sessionIds, session.id]} : batch)
            : [...current, {id:batchId, name:batchName, projectPath, sessionIds:[session.id]}];
        });
        await terminalRuntime.ensure(session);
        const state = terminalRuntime.snapshot(session.id);
        if (state.state === "error") throw new Error(state.error ?? "Agent launch failed");
        setSpawnProgress(index + 1);
      }
      await targetApi.importCanvasSessions(projectPath);
      await shared.refresh();
      await loadTeams();
      setComposerOpen(false);
    } catch (cause) {
      if (created) {
        // Preserve and reveal successful runs if a later launch fails.
        await projectApi(projectPath).importCanvasSessions(projectPath).catch(() => {});
        await shared.refresh().catch(() => {});
        await loadTeams();
      }
      setError(
        `${created ? `${created} of ${spawnCount} agents created. ` : ""}${cause instanceof Error ? cause.message : "Could not start agents"}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const approvePlan = async () => {
    if (!planTeam) return;
    const ownerApi = projectApi(planTeam.team.project_path);
    setBusy(true);
    try {
      await ownerApi.saveTeamPlan(
        planTeam.team.id,
        planTeam.team.goal,
        planTasks.map((task) => ({
          ...task,
          scope: task.scope?.filter((value) => value.trim()),
          depends_on: task.depends_on?.filter((value) => value.trim()),
          skills: task.skills?.filter((value) => value.trim()),
        })),
      );
      await ownerApi.approveTeamPlan(planTeam.team.id);
      setArmedTeamIds(current => [...new Set([...current, planTeam.team.id])]);
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
    const ownerApi = projectApi(selected.team.project_path);
    setBusy(true);
    try {
      setMergePreview(await ownerApi.previewSpatialTeamMerge(selected.team.id));
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
    if (!mergeTeam || !mergePreview?.ready) return;
    const ownerApi = projectApi(mergeTeam.team.project_path);
    setBusy(true);
    try {
      const result = await ownerApi.confirmSpatialTeamMerge(mergeTeam.team.id);
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
    const ownerApi = projectApi(selected.team.project_path);
    const title = workerName.trim();
    if (!title) return;
    setBusy(true);
    try {
      const task = await ownerApi.createSpatialTask(selected.team.id, {
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
        const started = await ownerApi.startSpatialTask(selected.team.id, task.id);
        if (started.session_id) {
          const session = await ownerApi.session(started.session_id);
          await terminalRuntime.ensure(session, selected.team.id, task.id);
        }
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
          onNodeClick={(_event, node) =>
            setSelectedId(node.data.team.team.id)
          }
          onNodeDragStart={(_event, node) =>
            setSelectedId(node.data.team.team.id)
          }
          onInit={(flow) => {
            canvasFlow.current = flow;
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
          <Background color="#76594d" gap={24} size={1.8} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) =>
              node.id === selectedId ? "#a855f7" : "#f97316"
            }
          />
          <Controls showInteractive={false} />
          <Panel position="top-right" className="sp-utilities"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button onClick={() => setComposerOpen(true)}>
              <LuBot /> New agent
            </button>
            <button onClick={() => setTeamDialog(true)}><LuUsers /> Create team</button>
            <button onClick={() => setPresetsOpen((value) => !value)}>Presets</button>
            <button onClick={() => void openFiles()}><LuFile /> Files</button>
              <button
                disabled={!shared.workspace}
                onClick={() =>
                  void projectApi(selected?.team.project_path ?? shared.workspace!.path)
                    .projectMemory(selected?.team.project_path ?? shared.workspace!.path)
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

          </Panel>
          {canvasTabs.length > 0 && (
            <Panel
              position="top-left"
              className="sp-tabs"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              onWheel={(event) => {
                // Horizontal tab scroll must not zoom the canvas.
                event.stopPropagation();
              }}
            >
              {canvasTabs.map(({ session, task }) => (
                <button
                  key={session.id}
                  type="button"
                  role="tab"
                  aria-selected={shared.activeId === session.id}
                  className="sp-tab"
                  data-active={shared.activeId === session.id}
                  data-status={task.status}
                  title={`${session.name} · ${task.status} — click to focus`}
                  onClick={() => openTerminal(session)}
                >
                  <span className="sp-tab-dot" aria-hidden="true" />
                  <span className="sp-tab-name">
                    {task.title.replace(/^Agent · /, "").slice(0, 28) || session.name}
                  </span>
                  <span className="sp-tab-status">{task.status}</span>
                </button>
              ))}
            </Panel>
          )}
          <Panel
            position="bottom-center"
            className="sp-bottom"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <nav className="sp-project-dock" aria-label="Projects">
              {shared.projects.map((project, index) => {
                const active = shared.workspace?.path === project.path;
                const running = shared.sessions.some((session) =>
                  session.project_path === project.path && session.status === "running",
                );
                return (
                  <div key={project.path} className="sp-dock-item">
                    <button type="button" className="sp-dock-run"
                      aria-label={`Run agent in ${project.name}`}
                      title={`Run agent in ${project.name}`}
                      onClick={() => {
                        setCommandProjectPath(project.path);
                        void shared.useProject(project.path).then(() => {
                          setComposerOpen(true);
                        }).catch((cause) => setError(String(cause)));
                      }}
                    >
                      <LuPlay aria-hidden="true" />
                    </button>
                  <button type="button" className="sp-dock-project"
                    aria-label={project.name} aria-current={active ? "page" : undefined}
                    data-active={active} data-running={running}
                    style={{ "--dock-hue": (index * 67 + 18) % 360 } as CSSProperties}
                    title={project.path}
                    onClick={() => {
                      setCommandProjectPath(project.path);
                      void shared.useProject(project.path).catch((cause) => setError(String(cause)));
                    }}
                  >
                    <span className="sp-dock-icon" aria-hidden="true">{project.name.slice(0, 2).toUpperCase()}</span>
                    <span className="sp-dock-label">{project.name}</span>
                    <span className="sp-dock-indicator" aria-hidden="true" />
                  </button>
                  </div>
                );
              })}
              <button type="button" className="sp-dock-project sp-dock-add"
                aria-label="Add project" title="Open a project folder"
                onClick={() => {
                  void shared.choose().then((project) => {
                    if (project) setCommandProjectPath(project.path);
                  }).catch((cause) => setError(String(cause)));
                }}
              >
                <span className="sp-dock-icon"><LuPlus /></span>
                <span className="sp-dock-label">Add project</span>
              </button>
            </nav>

          </Panel>
        </ReactFlow>
      )}

      {composerOpen && (
        <div className="sp-modal-backdrop sp-agent-modal" onClick={(event) => {
          if (event.target === event.currentTarget && !busy) setComposerOpen(false);
        }}>
              <div
                className="sp-composer"
                role="dialog"
                aria-modal="true"
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !busy) { event.stopPropagation(); setComposerOpen(false); }
                  if (event.key !== "Tab") return;
                  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")];
                  const first = controls[0], last = controls[controls.length - 1];
                  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                }}
                aria-label="Run configuration"
              >
                <div className="sp-composer-heading">
                  <div>
                    <strong>New agents</strong>
                    <small>Choose a CLI, how many agents to open, and where they run.</small>
                  </div>
                  <button
                    className="sp-icon"
                    aria-label="Close run configuration"
                    onClick={() => setComposerOpen(false)}
                  >
                    <LuX />
                  </button>
                </div>
                <div className="sp-run-project">
                  <span className="sp-run-project-icon"><LuFolderOpen aria-hidden="true" /></span>
                  <div className="sp-run-project-details">
                    <span className="sp-project-menu-label">Project</span>
                    <ProjectMenu projects={shared.projects} value={commandProjectPath}
                      onChange={setCommandProjectPath} disabled={busy} />
                    <small title={commandProjectPath}>{commandProjectPath}</small>
                  </div>
                </div>
                <div className="sp-run-count">
                  <div><label htmlFor="sp-agent-count">Number of agents</label>
                    <small>Each agent opens its own interactive terminal.</small></div>
                  <div className="sp-run-stepper">
                    <button type="button" aria-label="Fewer agents" disabled={busy || spawnCount <= 1}
                      onClick={() => setSpawnCount(value => value - 1)}>−</button>
                    <input id="sp-agent-count" type="number" min={1} max={12} value={spawnCount}
                      disabled={busy} autoFocus
                      onChange={event => setSpawnCount(Math.max(1, Math.min(12, Math.trunc(Number(event.target.value)) || 1)))} />
                    <button type="button" aria-label="More agents" disabled={busy || spawnCount >= 12}
                      onClick={() => setSpawnCount(value => value + 1)}>+</button>
                  </div>
                </div>
                <div className="sp-composer-grid">
                  <div className="sp-run-agent-field">
                    <span>Agent CLI</span>
                    <AgentPicker value={orchestrator} onChange={setOrchestrator} disabled={busy} />
                  </div>
                  <div className="sp-run-execution">
                    <span>Run location</span>
                    <div role="group" aria-label="Execution">
                      <button type="button" aria-pressed={worktreeMode === "root"}
                        disabled={busy} onClick={() => setWorktreeMode("root")}>Project root</button>
                      <button type="button" aria-pressed={worktreeMode === "worktree"}
                        disabled={busy} onClick={() => setWorktreeMode("worktree")}>New worktree</button>
                    </div>
                  </div>
                </div>
                <RunSkills project={commandProjectPath || shared.workspace?.path || ""}
                  selected={runSkills} onChange={setRunSkills} disabled={busy} onLoading={setSkillsLoading} />
                <div className="sp-composer-footer">
                  <span>
                    {worktreeMode === "worktree" ? "Each agent gets a separate worktree." : spawnCount > 1 ? "Agents share your project folder." : "Works directly in your project folder."}
                  </span>
                  <button type="button" className="sp-run-cancel" disabled={busy}
                    onClick={() => setComposerOpen(false)}>Cancel</button>
                  <button
                    className="sp-primary"
                    disabled={!(commandProjectPath || shared.workspace?.path) || busy || skillsLoading}
                    onClick={() => void runFromComposer()}
                  >
                    <LuPlay aria-hidden="true" />
                    {busy
                      ? `Starting ${spawnProgress} / ${spawnCount}…`
                      : spawnCount > 1 ? `Start ${spawnCount} agents` : "Start agent"}
                  </button>
                </div>
              </div>
        </div>
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
        <TeamCreateDialog project={shared.workspace?.path ?? ""} name={name} onName={setName}
          goal={goal} onGoal={setGoal} orchestrator={orchestrator} onOrchestrator={setOrchestrator}
          models={teamModels} onModel={(agent, model) => setTeamModels(current => ({ ...current, [agent]: model }))}
          workerModels={workerModels} onWorkerModel={(agent, model) => setWorkerModels(current => ({ ...current, [agent]: model }))}
          installed={installedTeamAgents} checking={checkingTeamAgents} allowed={allowedTeamAgents} onAllowed={setAllowedTeamAgents}
          concurrency={maxTeamActive} onConcurrency={setMaxTeamActive} skills={teamSkills} onSkills={setTeamSkills}
          onSkillsLoading={setSkillsLoading} busy={busy} skillsLoading={skillsLoading} error={error}
          onClose={() => setTeamDialog(false)} onCreate={() => void createTeam()} />
      )}

      {planOpen && planTeam && (
        <PlanReview
          name={planTeam.team.name}
          tasks={planTasks}
          setTasks={setPlanTasks}
          approve={() => void approvePlan()}
          close={() => setPlanOpen(false)}
          busy={busy}
        />
      )}

      {mergeOpen && mergeTeam && mergePreview && (
        <aside className="sp-float sp-merge">
          <header>
            <div>
              <small>User confirmation required</small>
              <h2>{mergeTeam.team.name} merge</h2>
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
          key={selected?.team.project_path ?? shared.workspace.path}
          project={selected?.team.project_path ?? shared.workspace.path}
          team={selected}
          close={() => setSkillsOpen(false)}
          refresh={loadTeams}
        />
      )}

      {filesOpen && shared.workspace && (
        <FilesPanel
          key={selected?.team.project_path ?? shared.workspace.path}
          project={selected?.team.project_path ?? shared.workspace.path}
          initialPath={jobPath}
          close={() => {
            setFilesOpen(false);
            setJobPath(undefined);
          }}
          terminal={(path) => {
            const projectPath = selected?.team.project_path ?? shared.workspace!.path;
            void projectApi(projectPath)
              .createSession({
                name: `Inspect ${path}`,
                kind: "terminal",
                agent: "shell",
                projectPath,
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
