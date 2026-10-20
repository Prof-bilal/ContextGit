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
  LuPlay,
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
import { harnessFor } from "@/shared/harnesses";
import { SKILLS } from "@/shared/roles";
import { terminalRuntime } from "../terminal/runtime";
import EmbeddedTerminal from "../terminal/EmbeddedTerminal";
import { useWorkbenchState } from "../useWorkbenchState";
import SkillsPanel from "./SkillsPanel";
import VoiceInput from "./VoiceInput";
import PlanReview from "./PlanReview";
import FilesPanel from "./FilesPanel";
import PresetsPanel, { type TeamPreset } from "./PresetsPanel";
import { useCanvasPreference } from "./useCanvasPreference";

const RuntimeTerminal = lazy(() => import("../terminal/RuntimeTerminal"));

type TeamNodeData = {
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
  layout: { width?: number; height?: number },
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
  const visibleTasks = team.tasks.filter(
    (task) =>
      !task.session_id ||
      sessions.some((session) => session.id === task.session_id),
  );
  // Cap live cards: extra workers render behind a "Show all" expander and
  // only attached sessions mount a real xterm (others show a static tail).
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
                  {session &&
                  (data.attachedIds?.includes(session.id) ||
                    data.activeSessionId === session.id) ? (
                    <EmbeddedTerminal sessionId={session.id} />
                  ) : session ? (
                    <button
                      type="button"
                      className="sp-term-placeholder nodrag"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        data.onAttach?.(session);
                      }}
                      title="Click to attach the live terminal"
                    >
                      <code>
                        &gt; {terminalRuntime.snapshot(session.id).tail.slice(-280) || task.brief || task.title}
                      </code>
                      <span className="sp-term-hint">
                        Click to attach live terminal · {task.status}
                      </span>
                    </button>
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
                Show all {visibleTasks.length} agents ({hiddenCount} hidden to save resources)
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
        isVisible
        lineStyle={{ borderWidth: 2 }}
        handleStyle={{ width: 12, height: 12, borderRadius: 3 }}
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
        <span className="sp-agent-pixel">✣</span>
        <span className="sp-agent-project" title={projectPath}>
          {projectLabel(projectPath)}
        </span>
        <strong>
          {harnessFor(session.agent)?.label ?? session.agent ?? "Agent"} ·{" "}
          {task.title.replace(/^Agent · /, "")}
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
      <span className="sp-worker-meta">
        {task.agent ?? "unassigned"} · {task.role}
      </span>
      <EmbeddedTerminal sessionId={session.id} />
    </section>
  );
});

const nodeTypes = { team: TeamNode, agent: AgentNode };

export default function SpatialShell({
  backendAvailable = true,
}: {
  backendAvailable?: boolean;
}) {
  const shared = useWorkbenchState();
  const [teams, setTeams] = useState<SpatialTeam[]>([]);
  const [nodes, setNodes] = useState<Node<TeamNodeData>[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [closedAgentIds, setClosedAgentIds] = useState<string[]>([]);
  const [attachedIds, setAttachedIds] = useState<string[]>([]);
  const [showAllTeams, setShowAllTeams] = useState<Record<string, boolean>>({});
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
  const [commandProjectPath, setCommandProjectPath] = useState(
    shared.workspace?.path ?? "",
  );
  const [commandTarget, setCommandTarget] = useState("orchestrator");
  const [composerOpen, setComposerOpen] = useState(false);
  const [runMode, setRunMode] = useState<"team" | "agent">("agent");
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
          (node.type === "agent" &&
            node.data.team.tasks.some((task) => task.session_id === sessionId)) ||
          (node.type === "team" &&
            node.data.team.tasks.some((task) => task.session_id === sessionId)),
      );
      if (target)
        window.requestAnimationFrame(() => {
          void flow
            .setCenter(target.position.x + 380, target.position.y + 260, {
              zoom: 0.95,
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
      setTerminalSession(session);
      focusAgentNode(session.id);
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
        .flatMap((team) => {
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

          return visibleTasks.map((task, index) => {
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
          });
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
  ]);

  const selected =
    teams.find(
      (team) => team.team.id === selectedId,
    ) ?? null;
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
    setPlanOpen(false);
    setMergeOpen(false);
    setCommandTarget("orchestrator");
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
    const signature = `${viewportProjectPath}:${focus.id}:${agentCount}`;
    if (centeredAgents.current === signature) return;
    centeredAgents.current = signature;
    window.requestAnimationFrame(() => {
      void flow.setCenter(focus.position.x + 380, focus.position.y + 260, {
        zoom: 0.9,
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
    if (document.hidden) return;
    for (const team of teams) {
      // Collapsed teams and closed agents hold no live xterm; skip them so
      // background ensure() calls don't resurrect hidden terminals.
      if (team.layout.collapsed) continue;
      const ids = [
        team.team.orchestrator_session_id,
        ...team.tasks.flatMap((task) => [
          task.session_id,
          task.verifier_session_id,
        ]),
      ];
      for (const id of ids) {
        if (!id || closedAgentIds.includes(id)) continue;
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
  }, [teams, shared.sessions, closedAgentIds]);

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
      const created = await api.createSpatialTeam({
        name: name.trim(),
        projectPath: shared.workspace.path,
        goal: requestedGoal.trim(),
        orchestratorAgent: orchestrator,
        baseRef: worktreeMode === "worktree" ? "HEAD" : undefined,
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
        [session.id]: `You are the parent orchestrator for team "${created.team.name}". You control and review every worker. Goal: ${requestedGoal.trim()}. Plan exactly ${agentCount} workers with these preferred roles: ${teamRoles || "generalist"}. Assign these worker CLIs in order: ${workerAgents.slice(0, agentCount).join(", ")}. Inspect the project and propose bounded worker tasks with disjoint file scopes, dependencies, done criteria, agents, and relevant skills. Worktree mode: ${worktreeMode}.`,
      }));
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
    const text = command.trim();
    const projectPath = commandProjectPath || shared.workspace?.path;
    if (!projectPath || !text) return;
    setGoal(text);
    if (runMode === "team") {
      await createTeam(text);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const targetApi = projectApi(projectPath);
      const session = await targetApi.createSession({
        name: `Agent · ${text.slice(0, 42)}`,
        kind: "terminal",
        agent: orchestrator,
        projectPath,
        worktree: worktreeMode === "worktree",
        baseRef: worktreeMode === "worktree" ? "HEAD" : undefined,
        task: text,
        role: teamRoles.split(",")[0]?.trim() || "generalist",
      });
      shared.addSession(session);
      await terminalRuntime.ensure(session);
      await targetApi.importCanvasSessions(projectPath);
      await shared.refresh();
      await loadTeams();
      setCommand("");
      setComposerOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start agent",
      );
    } finally {
      setBusy(false);
    }
  };

  const approvePlan = async () => {
    if (!selected) return;
    const ownerApi = projectApi(selected.team.project_path);
    setBusy(true);
    try {
      await ownerApi.saveTeamPlan(
        selected.team.id,
        selected.team.goal,
        planTasks.map((task) => ({
          ...task,
          scope: task.scope?.filter((value) => value.trim()),
          depends_on: task.depends_on?.filter((value) => value.trim()),
          skills: task.skills?.filter((value) => value.trim()),
        })),
      );
      await ownerApi.approveTeamPlan(selected.team.id);
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
    if (!selected || !mergePreview?.ready) return;
    const ownerApi = projectApi(selected.team.project_path);
    setBusy(true);
    try {
      const result = await ownerApi.confirmSpatialTeamMerge(selected.team.id);
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
        await ownerApi.startSpatialTask(selected.team.id, task.id);
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
    const ownerApi = projectApi(selected.team.project_path);
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
      if (!session) session = await ownerApi.startOrchestrator(selected.team.id);
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
          <Background color="#42382f" gap={24} size={1.15} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) =>
              node.id === selectedId ? "#a855f7" : "#f97316"
            }
          />
          <Controls showInteractive={false} />
          <Panel position="top-right" className="sp-canvas-hint">
            Drag agents · Scroll to zoom · Select a project in the command bar
          </Panel>
          {canvasTabs.length > 0 && (
            <Panel
              position="top-center"
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
            <div className="sp-actions">
              <button
                onClick={() => {
                  setRunMode("agent");
                  setComposerOpen(true);
                }}
              >
                <LuBot /> New agent
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
                className="sp-orchestration-only"
                onClick={() => setWorkerDialog(true)}
              >
                <LuUsers /> Spawn agent
              </button>
              {selected?.team.state === "ready" &&
                selected.plan?.status === "approved" && (
                  <button className="sp-orchestration-only"
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
                className="sp-orchestration-only"
                onClick={() => setGroupDialog(true)}
              >
                Group ({selectedWorkers.length})
              </button>
              <button
                className="sp-orchestration-only"
                disabled={!selected}
                onClick={() =>
                  selected &&
                  void (
                    selected.team.state === "paused"
                      ? projectApi(selected.team.project_path).resumeSpatialTeam(selected.team.id)
                      : projectApi(selected.team.project_path).pauseSpatialTeam(selected.team.id)
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
              <button
                className="sp-orchestration-only"
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
                className="sp-command-project"
                aria-label="Run project"
                value={commandProjectPath}
                onChange={(event) => setCommandProjectPath(event.target.value)}
                disabled={!shared.projects.length}
              >
                {shared.projects.map((project) => (
                  <option key={project.path} value={project.path}>
                    {project.name}
                  </option>
                ))}
              </select>
              <button
                className="sp-command-mode"
                aria-label="Run configuration"
                onClick={() => setComposerOpen((value) => !value)}
              >
                {runMode === "team" ? <LuUsers /> : <LuBot />}{" "}
                {runMode === "team" ? "Team" : "Agent"}
              </button>
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter")
                    void runFromComposer();
                }}
                placeholder={
                  composerOpen
                    ? "Describe the goal for this run…"
                    : selected
                      ? `Direct ${commandTarget === "orchestrator" ? `${selected.team.name}'s orchestrator` : "selected worker"}…`
                      : "Describe a goal to start a new run…"
                }
                disabled={!shared.workspace}
              />
              <button
                className="sp-send"
                disabled={!shared.workspace || !command.trim()}
                onClick={() =>
                  void runFromComposer()
                }
              >
                <LuSend />
              </button>
            </div>
            {composerOpen && (
              <div
                className="sp-composer"
                role="dialog"
                aria-label="Run configuration"
              >
                <div className="sp-composer-heading">
                  <div>
                    <strong>New run</strong>
                    <small>Choose how this prompt should run</small>
                  </div>
                  <button
                    className="sp-icon"
                    aria-label="Close run configuration"
                    onClick={() => setComposerOpen(false)}
                  >
                    <LuX />
                  </button>
                </div>
                <div className="sp-composer-grid">
                  <label>
                    Mode
                    <select
                      value={runMode}
                      onChange={(event) =>
                        setRunMode(event.target.value as "team" | "agent")
                      }
                    >
                      <option value="agent">Single agent</option>
                    </select>
                  </label>
                  <label>
                    Project root
                    <input
                      value={commandProjectPath || "Choose a project"}
                      readOnly
                    />
                  </label>
                  <label>
                    Execution
                    <select
                      value={worktreeMode}
                      onChange={(event) =>
                        setWorktreeMode(
                          event.target.value as "root" | "worktree",
                        )
                      }
                    >
                      <option value="root">Project root</option>
                      <option value="worktree">Fresh worktree</option>
                    </select>
                  </label>
                  <label>
                    CLI
                    <select
                      value={orchestrator}
                      onChange={(event) => setOrchestrator(event.target.value)}
                    >
                      {HARNESSES.map((harness) => (
                        <option key={harness.id} value={harness.id}>
                          {harness.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {runMode === "team" && (
                    <>
                      <label>
                        Worker agents
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={agentCount}
                          onChange={(event) =>
                            setAgentCount(
                              Math.max(
                                1,
                                Math.min(12, Number(event.target.value) || 1),
                              ),
                            )
                          }
                        />
                      </label>
                      <label className="sp-composer-wide">
                        Roles
                        <input
                          value={teamRoles}
                          onChange={(event) => setTeamRoles(event.target.value)}
                          placeholder="frontend, backend, tests, docs"
                        />
                        <small>
                          Comma-separated roles proposed to the orchestrator
                        </small>
                      </label>
                      <div className="sp-composer-wide sp-agent-assignments">
                        <div className="sp-assignment-heading">
                          <span>Worker AI assignments</span>
                          <small>
                            The parent orchestrator coordinates and reviews
                            every worker.
                          </small>
                        </div>
                        <div className="sp-assignment-grid">
                          {Array.from({ length: agentCount }, (_, index) => (
                            <label key={index}>
                              Agent {index + 1}
                              <select
                                value={workerAgents[index] ?? "claude"}
                                onChange={(event) =>
                                  setWorkerAgents((current) => {
                                    const next = [...current];
                                    next[index] = event.target.value;
                                    return next;
                                  })
                                }
                              >
                                {HARNESSES.map((harness) => (
                                  <option key={harness.id} value={harness.id}>
                                    {harness.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="sp-composer-footer">
                  <span>
                    {runMode === "team"
                      ? `${agentCount} workers · ${worktreeMode === "worktree" ? "isolated worktree" : "shared project root"}`
                      : `${worktreeMode === "worktree" ? "isolated worktree" : "project root"}`}
                  </span>
                  <button
                    className="sp-primary"
                    disabled={!shared.workspace || !command.trim() || busy}
                    onClick={() => void runFromComposer()}
                  >
                    {busy
                      ? "Starting…"
                      : runMode === "team"
                        ? "Create team"
                        : "Start agent"}
                  </button>
                </div>
              </div>
            )}
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
