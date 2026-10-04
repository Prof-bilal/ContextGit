import { useCallback, useEffect, useRef, useState } from "react";
import { LuCommand, LuCornerUpLeft, LuMoon, LuPanelRight, LuSun, LuX } from "react-icons/lu";

import {
  api,
  type BranchBudget,
  type Message,
  type ProviderCapability,
  type Session,
  type Task,
} from "@/lib/api";
import { CONVERSATIONS, NAMED_AGENTS, type NamedAgent } from "../mock/fixtures";
import { agentLabel } from "./agents";
import AgentDialog from "./agent/AgentDialog";
import { DEFAULT_DRAFT, draftFrom, humanSchedule, newSeed, type MissionDraft } from "./agent/mission";
import BranchDialog from "./git/BranchDialog";
import { commitsOnBranch } from "./git/branchCommits";
import DiffSheet from "./git/DiffSheet";
import DeleteBranchDialog from "./git/DeleteBranchDialog";
import MergeDialog from "./git/MergeDialog";
import { useRepo } from "./git/useRepo";
import { AgentMark, Chip, Field, IconButton, MiniSeg, StatusIcon } from "./primitives";
import { Dock } from "./Dock";
import ModelPicker from "./ModelPicker";
import AddProviderDialog from "./chat/AddProviderDialog";
import GovernorPanel from "./chat/GovernorPanel";
import { isReady } from "./chat/providerStatus";
import { useProviders } from "./chat/useProviders";
import { brandFor, type ModelSelection } from "./providers";
import TopNav, { type TabDef, type TabId } from "./TopNav";
import AgentRail from "./rail/AgentRail";
import ChatRail from "./rail/ChatRail";
import GitRail, { type CommitFilter } from "./rail/GitRail";
import RosterRail from "./rail/RosterRail";
import { useFleet } from "./terminal/useFleet";
import { useMergeQueue } from "./terminal/useMergeQueue";
import { useSessions } from "./terminal/useSessions";
import PaneCanvas, { type PaneLayout } from "./terminal/PaneCanvas";
import TaskDetail from "./team/TaskDetail";
import TaskForm from "./team/TaskForm";
import TeamMessages from "./team/TeamMessages";
import TeamRail from "./team/TeamRail";
import { useTeam } from "./team/useTeam";
import AgentView from "./views/AgentView";
import ChatView from "./views/ChatView";
import CodeView from "./views/CodeView";
import GitView from "./views/GitView";
import TeamView from "./views/TeamView";
import ProjectPicker from "./workspace/ProjectPicker";
import { useWorkspace } from "./workspace/useWorkspace";

type Theme = "dark" | "light";

const TAB_IDS: TabId[] = ["chat", "code", "agent", "git"];

/** The Code tab's two surfaces: one run at a time, or a task graph. */
const MODE_OPTIONS = [
  { value: "single" as const, label: "Single" },
  { value: "team" as const, label: "Team" },
];

function initialTab(): TabId {
  const value = new URLSearchParams(window.location.search).get("tab");
  return TAB_IDS.find((tab) => tab === value) ?? "code";
}

export default function Shell() {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [theme, setTheme] = useState<Theme>("dark");
  const [dockOpen, setDockOpen] = useState(true);
  // ---- Code tab: Single (one run at a time) or Team (a task graph) ----
  const [mode, setMode] = useState<"single" | "team">(() => {
    const stored = window.localStorage.getItem("cg-code-mode");
    return stored === "team" ? "team" : "single";
  });
  const [layout, setLayout] = useState<PaneLayout>("single");

  // ---- Code tab: real sessions + terminals ----
  const { sessions, error: sessionsError, refresh, create, remove, setAutoCommit } = useSessions();
  const { fleet, error: fleetError } = useFleet();
  const mergeQueue = useMergeQueue();
  const { board: teamBoard, error: teamError, refresh: refreshTeam, act: teamAct } = useTeam();
  const { workspace, error: workspaceError, choose, pickLocation, create: createWorkspace } = useWorkspace();
  const [projectOpen, setProjectOpen] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [staged, setStaged] = useState<Message[]>([]);
  const [summary, setSummary] = useState("");
  const [revision, setRevision] = useState(0);
  const [barError, setBarError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<{ task: Task | null } | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);
  /** Session id → the one-line briefing typed into that terminal once it is up. */
  const [kickoff, setKickoff] = useState<Record<string, string>>({});

  // ---- Chat + Agent tabs read fixtures; Git reads the real repo snapshot ----
  const [conversationName, setConversationName] = useState(CONVERSATIONS[0]?.branch.name ?? "");
  const [agentId, setAgentId] = useState(NAMED_AGENTS[0]?.id ?? "");
  const [agents, setAgents] = useState<NamedAgent[]>(NAMED_AGENTS);
  const [agentDialog, setAgentDialog] = useState<{ mode: "create" | "edit"; draft: MissionDraft } | null>(
    null,
  );
  const [commitId, setCommitId] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [filter, setFilter] = useState<CommitFilter>("all");
  const [diffOpen, setDiffOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchToDelete, setBranchToDelete] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const { snapshot, loading: repoLoading, error: repoError, refresh: refreshRepo } = useRepo();
  const {
    providers,
    error: providersError,
    add: addProvider,
    remove: removeProvider,
    test: testProvider,
    fetchModels: fetchProviderModels,
  } = useProviders();
  const [model, setModel] = useState<ModelSelection>({ providerId: "", modelId: "" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [providerDialog, setProviderDialog] = useState<{
    capability?: ProviderCapability;
    initialId?: string;
  } | null>(null);
  const [offlineOk, setOfflineOk] = useState(false);
  const [budget, setBudget] = useState<BranchBudget | null>(null);
  const [budgetTick, setBudgetTick] = useState(0);

  // Usable providers per capability (real keys / enabled local servers; not mocks).
  const readyChatCount = providers.filter((p) => p.capability === "chat" && isReady(p)).length;
  const readyImageCount = providers.filter((p) => p.capability === "image" && isReady(p)).length;
  const readySearchCount = providers.filter((p) => p.capability === "search" && isReady(p)).length;

  const openProviderDialog = useCallback(
    (capability?: ProviderCapability, initialId?: string) =>
      setProviderDialog({ capability, initialId }),
    [],
  );

  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const activeConversation =
    CONVERSATIONS.find((conversation) => conversation.branch.name === conversationName) ??
    CONVERSATIONS[0];
  const activeAgent = agents.find((agent) => agent.id === agentId) ?? agents[0];

  // ---- Git tab: the real snapshot ----
  const branches = snapshot?.branches ?? [];
  const commits = [...(snapshot?.commits ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const branchHead =
    branches.find((branch) => branch.name === selectedBranch)?.head_commit_id ?? null;
  // History is scoped to the selected branch, so clicking a branch changes it.
  const branchCommits = branchHead ? commitsOnBranch(commits, branchHead) : commits;
  const activeCommit = commits.find((commit) => commit.id === commitId) ?? branchCommits[0] ?? null;
  const activeCommitTags = (snapshot?.tags ?? []).filter((tag) => tag.commit_id === activeCommit?.id);

  // Keep the branch selection valid; default to the repo's current branch.
  useEffect(() => {
    if (!snapshot) return;
    setSelectedBranch((current) =>
      current && snapshot.branches.some((branch) => branch.name === current)
        ? current
        : snapshot.current_branch || snapshot.branches[0]?.name || "",
    );
  }, [snapshot]);

  // Follow the branch when nothing valid is selected; never clobber a commit pick.
  useEffect(() => {
    if (!snapshot) return;
    const head =
      snapshot.branches.find((branch) => branch.name === selectedBranch)?.head_commit_id ?? null;
    setCommitId((current) =>
      current && snapshot.commits.some((commit) => commit.id === current) ? current : head,
    );
  }, [snapshot, selectedBranch]);

  // Pick a working default once the registry loads: prefer a configured,
  // non-mock provider; fall back to the offline mock; never leave a stale pick.
  useEffect(() => {
    if (providers.length === 0) return;
    setModel((current) => {
      const ready = providers.filter(
        (provider) =>
          provider.capability === "chat" && isReady(provider) && provider.models.length > 0,
      );
      const mocks = providers.filter(
        (provider) =>
          provider.capability === "chat" &&
          provider.kind === "mock" &&
          provider.models.length > 0,
      );
      // A connected provider wins; the mock is only the offline fallback.
      const pick = ready.find((provider) => provider.kind !== "local") ?? ready[0] ?? mocks[0];
      if (!pick) return current;
      if (pick.id === current.providerId && pick.models.includes(current.modelId)) return current;
      const preferred =
        pick.default_model && pick.models.includes(pick.default_model)
          ? pick.default_model
          : pick.models[0];
      return { providerId: pick.id, modelId: preferred };
    });
  }, [providers]);

  // Real context size of the chat branch (refresh after each committed turn).
  useEffect(() => {
    const branchName = snapshot?.current_branch;
    if (!branchName) return;
    let alive = true;
    void api
      .branchBudget(branchName)
      .then((value) => {
        if (alive) setBudget(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [snapshot?.current_branch, budgetTick]);

  // Ask for a key the first time the Chat tab opens with nothing connected.
  const promptedForProvider = useRef(false);
  useEffect(() => {
    if (promptedForProvider.current || tab !== "chat") return;
    if (providers.length === 0) return;
    promptedForProvider.current = true;
    if (readyChatCount === 0) openProviderDialog("chat");
  }, [tab, providers.length, readyChatCount, openProviderDialog]);

  const chooseBranch = (name: string) => {
    setSelectedBranch(name);
    const head = branches.find((branch) => branch.name === name)?.head_commit_id ?? null;
    if (head) setCommitId(head);
  };

  /** Switch the repo's current branch, then reload so HEAD-derived state follows. */
  const checkoutBranch = async (name: string) => {
    try {
      await api.checkout(name);
      setBarError(null);
      chooseBranch(name);
      await refreshRepo();
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not switch branch");
    }
  };

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
        if (alive) setBarError(cause instanceof Error ? cause.message : "Could not load staging");
      });
    return () => {
      alive = false;
    };
  }, [activeSession, revision]);

  const openSession = useCallback((session: Session) => {
    setOpenIds((current) => (current.includes(session.id) ? current : [...current, session.id]));
    setActiveId(session.id);
    setSummary("");
    setBarError(null);
  }, []);

  const startRun = useCallback(
    async (name: string, agent: string, scope: string[]) => {
      if (!workspace) {
        setProjectOpen(true);
        throw new Error("Choose a project folder first");
      }
      const created = await create(name, agent, workspace.path, scope);
      openSession(created);
    },
    [create, openSession, workspace],
  );

  const newTerminal = useCallback(async () => {
    if (!workspace) {
      setProjectOpen(true);
      setBarError("Choose a project folder first");
      return;
    }
    try {
      const shellCount = sessions.filter((session) => (session.agent ?? "shell") === "shell").length;
      const created = await create(`shell ${shellCount + 1}`, "shell", workspace.path);
      openSession(created);
    } catch (cause) {
      setBarError(cause instanceof Error ? cause.message : "Could not open a terminal");
    }
  }, [create, openSession, sessions, workspace]);

  // ---- Team mode: the task graph, its board feed and its runs ----
  const teamTasks = teamBoard?.tasks ?? [];
  const taskTitles = Object.fromEntries(teamTasks.map((task) => [task.id, task.title]));
  const selectedTask = teamTasks.find((task) => task.id === selectedTaskId) ?? null;

  const changeMode = useCallback((next: "single" | "team") => {
    setMode(next);
    window.localStorage.setItem("cg-code-mode", next);
    setLayout(next === "team" ? "split" : "single");
  }, []);

  /** The line a freshly started agent reads before its task brief. */
  const briefingFor = useCallback((task: Task) => {
    const parts = [
      `Read .contextgit/team.md and start task "${task.title}"`,
      task.scope.length > 0 ? `you own ${task.scope.join(", ")}` : "no files claimed yet",
      task.depends_on.length > 0 ? "your dependencies are done" : "nothing blocks you",
    ];
    return `${parts.join(". ")}. Post a note when you finish.`;
  }, []);

  /** The line an independent verifier reads before it inspects the work. */
  const verifierBriefingFor = useCallback((task: Task) => {
    const criteria = task.done_criteria ? `Done criteria: ${task.done_criteria}. ` : "";
    return (
      `Read .contextgit/team.md and review task "${task.title}" as an independent verifier. ` +
      `${criteria}Inspect the diff of this branch against the criteria, then post your ` +
      "findings as a note. Do not change any files."
    );
  }, []);

  // Working tasks and their verifier runs get a terminal, briefed once each.
  // Only sessions this effect has not opened before are touched, so it never
  // steals focus from a run the user picked.
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

  /** Session id → the team task it belongs to, so the MCP tools know the run. */
  const taskIds = Object.fromEntries(
    teamTasks.flatMap((task) => [
      ...(task.session_id ? [[task.session_id, task.id] as const] : []),
      ...(task.verifier_session_id ? [[task.verifier_session_id, task.id] as const] : []),
    ]),
  );

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

  const closeTerminal = useCallback((session: Session) => {
    // The pane owns its PTY and kills it on unmount; just drop it from the layout.
    setOpenIds((current) => current.filter((id) => id !== session.id));
    setActiveId((current) => (current === session.id ? null : current));
  }, []);

  const deleteRun = useCallback(
    async (session: Session) => {
      setOpenIds((current) => current.filter((id) => id !== session.id));
      setActiveId((current) => (current === session.id ? null : current));
      try {
        await remove(session.id);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not delete run");
      }
    },
    [remove],
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

  /** Create a new agent, or save edits to the selected one. */
  const saveAgent = useCallback(
    (draft: MissionDraft) => {
      const routine = {
        enabled: draft.enabled,
        cron: draft.cron,
        human: humanSchedule(draft.cron),
        nextRuns: [],
      };
      if (agentDialog?.mode === "edit") {
        setAgents((current) =>
          current.map((entry) =>
            entry.id === activeAgent.id
              ? {
                  ...entry,
                  name: draft.name.trim() || entry.name,
                  brief: draft.mission.trim(),
                  skills: draft.skills,
                  hue: draft.hue,
                  seed: draft.seed,
                  monogram: draft.name.trim().charAt(0).toUpperCase() || entry.monogram,
                  routine: { ...entry.routine, ...routine },
                }
              : entry,
          ),
        );
        return;
      }
      const slug =
        draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24) || "new";
      const created: NamedAgent = {
        id: `agent_${slug}_${Math.random().toString(36).slice(2, 6)}`,
        name: draft.name.trim(),
        monogram: draft.name.trim().charAt(0).toUpperCase(),
        hue: draft.hue,
        seed: draft.seed,
        brief: draft.mission.trim(),
        memory: { decisions: [], facts: [], deadEnds: [], openQuestions: [] },
        skills: draft.skills,
        routine,
        runs: [],
      };
      setAgents((current) => [...current, created]);
      setAgentId(created.id);
    },
    [agentDialog?.mode, activeAgent.id],
  );

  const tabs: TabDef[] = [
    { id: "chat", label: "Chat" },
    { id: "code", label: "Code" },
    { id: "agent", label: "Agent" },
    { id: "git", label: "Git" },
  ];

  const rail = () => {
    switch (tab) {
      case "chat":
        return (
          <ChatRail
            selectedBranch={activeConversation.branch.name}
            onSelect={(conversation) => setConversationName(conversation.branch.name)}
          />
        );
      case "code":
        return mode === "team" ? (
          <TeamRail
            tasks={teamTasks}
            sessions={sessions}
            selectedId={selectedTaskId}
            onSelect={selectTask}
            onNew={() => setTaskForm({ task: null })}
          />
        ) : (
          <AgentRail
            sessions={sessions}
            fleet={fleet}
            openIds={openIds}
            activeId={activeId}
            onSelect={openSession}
            onNew={startRun}
            onDelete={(session) => void deleteRun(session)}
          />
        );
      case "agent":
        return (
          <RosterRail
            agents={agents}
            selectedId={agentId}
            onSelect={(agent) => setAgentId(agent.id)}
            onNewAgent={() =>
              setAgentDialog({ mode: "create", draft: { ...DEFAULT_DRAFT, seed: newSeed("") } })
            }
          />
        );
      case "git":
        return (
          <GitRail
            branches={branches}
            commits={commits}
            currentBranch={snapshot?.current_branch ?? ""}
            selectedBranch={selectedBranch}
            onSelectBranch={chooseBranch}
            onCheckout={(name) => void checkoutBranch(name)}
            onDelete={(name) => setBranchToDelete(name)}
            filter={filter}
            onFilter={setFilter}
          />
        );
    }
  };

  const view = () => {
    switch (tab) {
      case "chat":
        return (
          <ChatView
            conversation={activeConversation}
            selection={model}
            providers={providers}
            branch={snapshot?.current_branch ?? ""}
            commitId={
              branches.find((branch) => branch.name === snapshot?.current_branch)
                ?.head_commit_id ?? null
            }
            onPickModel={() => setPickerOpen(true)}
            onAddProvider={openProviderDialog}
            onCommitted={() => setBudgetTick((value) => value + 1)}
            readyChatCount={readyChatCount}
            readyImageCount={readyImageCount}
            readySearchCount={readySearchCount}
            offlineOk={offlineOk}
            onUseOffline={() => setOfflineOk(true)}
          />
        );
      case "agent":
        return (
          <AgentView
            agent={activeAgent}
            onUpdate={(patch) =>
              setAgents((current) =>
                current.map((entry) => (entry.id === activeAgent.id ? { ...entry, ...patch } : entry)),
              )
            }
            onEditMission={() =>
              setAgentDialog({ mode: "edit", draft: draftFrom(activeAgent) })
            }
          />
        );
      case "git":
        return (
          <GitView
            branches={branches}
            commits={branchCommits}
            allCommits={commits}
            branch={selectedBranch}
            selectedId={activeCommit?.id ?? null}
            onSelect={(commit) => setCommitId(commit.id)}
            filter={filter}
            tags={snapshot?.tags ?? []}
            loading={repoLoading}
            onRefresh={() => void refreshRepo()}
          />
        );
      default:
        return null;
    }
  };

  const dock = () => {
    switch (tab) {
      case "chat": {
        const chatProvider = providers.find((provider) => provider.id === model.providerId);
        const chatBrand = brandFor(model.providerId, chatProvider?.label ?? "");
        const chatBranch = snapshot?.current_branch ?? "";
        const chatHead =
          branches.find((branch) => branch.name === chatBranch)?.head_commit_id ?? null;
        const governorCommits = (chatHead ? commitsOnBranch(commits, chatHead) : [])
          .slice(0, 6)
          .map((commit) => ({
            id: commit.id,
            kind: commit.kind,
            summary: commit.summary,
            model: commit.model,
            tokens: commit.token_count,
          }));
        return (
          <>
            <button
              type="button"
              className="cg-model-card"
              onClick={() => setPickerOpen(true)}
              aria-haspopup="dialog"
              title="Change provider and model"
            >
              <AgentMark
                agent={chatBrand.hue}
                icon={chatBrand.icon}
                label={chatBrand.monogram}
              />
              <span className="cg-model-card-copy">
                <strong>{model.modelId || "Choose a model"}</strong>
                <span>{chatProvider?.label ?? "Add a provider"}</span>
              </span>
              <span className="cg-model-card-action">Change</span>
            </button>
            <div className="cg-fields">
              <Field label="Branch">{chatBranch || "—"}</Field>
              <Field label="Head">{(budget?.head ?? chatHead ?? "").slice(0, 7) || "—"}</Field>
              <Field label="Messages">{budget?.messages ?? 0}</Field>
            </div>
            <GovernorPanel
              used={budget?.used ?? 0}
              budget={20_000}
              messages={budget?.messages ?? 0}
              commits={governorCommits}
            />
            <section className="cg-prov" aria-label="Provenance">
              <header className="cg-block-head">
                <span className="cg-kicker">Provenance</span>
              </header>
              <p className="cg-empty-note">
                Hover a message → <LuCornerUpLeft aria-hidden="true" /> blame shows the commit that
                introduced it on this branch.
              </p>
            </section>
          </>
        );
      }
      case "code":
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
                  onChange={(event) => void setAutoCommit(activeSession.id, event.target.checked)}
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
          </>
        ) : (
          <p className="cg-empty-note">Select a run to inspect it.</p>
        );
      case "agent":
        return (
          <>
            <div className="cg-fields">
              <Field label="Agent">{activeAgent.name}</Field>
              <Field label="Routine">
                <span className="cg-routine-code">{activeAgent.routine.cron}</span>
              </Field>
              <Field label="Schedule">{activeAgent.routine.human}</Field>
              <Field label="Skills">{activeAgent.skills.length}</Field>
              <Field label="Runs">{activeAgent.runs.length}</Field>
            </div>
            <div className="cg-dock-actions">
              <button
                type="button"
                className="cg-btn"
                data-variant="primary"
                aria-haspopup="dialog"
                onClick={() => setAgentDialog({ mode: "edit", draft: draftFrom(activeAgent) })}
              >
                Edit brief
              </button>
            </div>
          </>
        );
      case "git":
        return activeCommit ? (
          <>
            <div className="cg-fields">
              <Field label="Commit">
                <span className="cg-mono">{activeCommit.id.slice(0, 7)}</span>
              </Field>
              <Field label="Kind">
                <Chip>{activeCommit.kind}</Chip>
              </Field>
              <Field label="Summary">{activeCommit.summary ?? "—"}</Field>
              <Field label="Model">{activeCommit.model}</Field>
              <Field label="Author">{activeCommit.author ?? "—"}</Field>
              <Field label="Parents">
                {activeCommit.parent_ids.length > 0
                  ? activeCommit.parent_ids.map((id) => id.slice(0, 7)).join(", ")
                  : "root commit"}
              </Field>
              <Field label="Messages">{activeCommit.messages.length}</Field>
              <Field label="Tags">
                {activeCommitTags.length > 0
                  ? activeCommitTags.map((tag) => tag.name).join(", ")
                  : "—"}
              </Field>
            </div>
            <div className="cg-dock-actions">
              <button
                type="button"
                className="cg-btn"
                onClick={() => setBranchOpen(true)}
                aria-haspopup="dialog"
              >
                Branch from here
              </button>
              <button
                type="button"
                className="cg-btn"
                onClick={() => setDiffOpen(true)}
                aria-haspopup="dialog"
              >
                View diff
              </button>
            </div>
          </>
        ) : (
          <p className="cg-empty-note">Select a commit to inspect it.</p>
        );
    }
  };

  const bottomBar = () => {
    if (tab === "agent") {
      return (
        <footer className="cg-bottombar">
          <span className="cg-bb-info">
            <strong>{activeAgent.name}</strong>
            <Chip tone={activeAgent.routine.enabled ? "ok" : "warn"}>
              {activeAgent.routine.enabled ? "routine on" : "paused"}
            </Chip>
            <span className="cg-view-sub">{activeAgent.routine.human}</span>
          </span>
        </footer>
      );
    }
    if (tab === "git") {
      return (
        <footer className="cg-bottombar">
          <span className="cg-bb-info">
            <span className="cg-view-sub">
              {activeCommit
                ? `${activeCommit.id.slice(0, 7)} · ${activeCommit.kind} · ${activeCommit.messages.length} messages`
                : "No commit selected."}
            </span>
          </span>
          <span className="cg-bb-actions cg-bb-end">
            <button
              type="button"
              className="cg-btn"
              data-variant="primary"
              disabled={branches.length < 2}
              onClick={() => setMergeOpen(true)}
              aria-haspopup="dialog"
            >
              Review merge…
            </button>
          </span>
        </footer>
      );
    }
    if (tab === "chat") {
      // No commit bar: the composer is the bottom edge, and the inspector already
      // shows branch / head / budget.
      return null;
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
    // Code
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

  const dockTitle =
    tab === "code"
      ? mode === "team"
        ? "Task"
        : "Run"
      : tab === "chat"
        ? "Conversation"
        : tab === "agent"
          ? "Agent"
          : "Commit";

  const notice =
    sessionsError ??
    barError ??
    repoError ??
    workspaceError ??
    fleetError ??
    teamError ??
    mergeQueue.error ??
    providersError;

  return (
    <div className="cg-shell" data-cg-theme={theme}>
      <header className="cg-titlebar">
        <span className="cg-brand">
          Context<b>Git</b>
          <small>WORKSPACE</small>
        </span>
        <TopNav tabs={tabs} active={tab} onChange={setTab} />
        {tab === "code" && (
          <MiniSeg value={mode} options={MODE_OPTIONS} onChange={changeMode} label="Code mode" />
        )}
        <span className="cg-titlebar-spacer" />
        <button type="button" className="cg-command-hint">
          <LuCommand aria-hidden="true" />K
        </button>
        <button
          type="button"
          className="cg-theme-btn"
          aria-pressed={theme === "dark"}
          onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
        >
          <span aria-hidden="true">{theme === "dark" ? <LuSun /> : <LuMoon />}</span>
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <IconButton
          label={dockOpen ? "Hide inspector" : "Show inspector"}
          pressed={dockOpen}
          onClick={() => setDockOpen((value) => !value)}
        >
          <LuPanelRight aria-hidden="true" />
        </IconButton>
      </header>

      {notice && (
        <p className="cg-banner" role="alert">
          {notice}
        </p>
      )}

      <div className="cg-body" data-dock={dockOpen ? "open" : "closed"}>
        {rail()}
        <main
          className="cg-main"
          id={`cg-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`cg-tab-${tab}`}
        >
          {/* Code stays mounted (hidden) so live terminals survive tab switches. */}
          <div className="cg-view" data-active={tab === "code"} data-code-mode={mode}>
            {mode === "team" ? (
              <TeamView
                tasks={teamTasks}
                sessions={sessions}
                layout={layout}
                onLayout={setLayout}
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
                layout={layout}
                onLayout={setLayout}
                workspace={workspace}
                onNewTerminal={() => void newTerminal()}
                onChooseProject={() => setProjectOpen(true)}
              />
            )}
            {/* One canvas for both modes: switching must never restart an agent. */}
            <PaneCanvas
              sessions={sessions}
              openIds={openIds}
              activeId={activeId}
              layout={layout}
              theme={theme}
              kickoff={kickoff}
              taskIds={taskIds}
              onSelect={openSession}
              onClose={closeTerminal}
              onStaged={() => setRevision((value) => value + 1)}
              onStatus={() => void refresh()}
            />
          </div>
          {tab !== "code" && (
            <div className="cg-view" data-active>
              {view()}
            </div>
          )}
        </main>
        {dockOpen && (
          <Dock title={dockTitle} onClose={() => setDockOpen(false)}>
            {dock()}
          </Dock>
        )}
      </div>

      {bottomBar()}

      {pickerOpen && (
        <ModelPicker
          providers={providers}
          selection={model}
          onSelect={setModel}
          onAddProvider={() => openProviderDialog("chat")}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {providerDialog && (
        <AddProviderDialog
          providers={providers}
          initialId={providerDialog.initialId}
          capability={providerDialog.capability}
          add={addProvider}
          remove={removeProvider}
          test={testProvider}
          fetchModels={fetchProviderModels}
          onSaved={() => undefined}
          onClose={() => setProviderDialog(null)}
        />
      )}

      {taskForm && (
        <TaskForm
          task={taskForm.task}
          tasks={teamTasks}
          onSaved={() => void refreshTeam()}
          onClose={() => setTaskForm(null)}
        />
      )}

      {projectOpen && (
        <ProjectPicker
          workspace={workspace}
          onChoose={choose}
          onPickLocation={pickLocation}
          onCreate={createWorkspace}
          onClose={() => setProjectOpen(false)}
        />
      )}

      {agentDialog && (
        <AgentDialog
          mode={agentDialog.mode}
          initial={agentDialog.draft}
          onSave={saveAgent}
          onClose={() => setAgentDialog(null)}
        />
      )}

      {diffOpen && activeCommit && (
        <DiffSheet
          commit={activeCommit}
          parentId={activeCommit.parent_ids[0] ?? null}
          onClose={() => setDiffOpen(false)}
        />
      )}

      {branchOpen && activeCommit && (
        <BranchDialog
          commit={activeCommit}
          onCreated={() => void refreshRepo()}
          onClose={() => setBranchOpen(false)}
        />
      )}

      {branchToDelete && (
        <DeleteBranchDialog
          name={branchToDelete}
          onDeleted={() => {
            // If we deleted the branch we were viewing, fall back to the repo's.
            if (selectedBranch === branchToDelete) {
              chooseBranch(snapshot?.current_branch || branches[0]?.name || "");
            }
            void refreshRepo();
          }}
          onClose={() => setBranchToDelete(null)}
        />
      )}

      {mergeOpen && (
        <MergeDialog
          branches={branches}
          target={selectedBranch || snapshot?.current_branch || ""}
          onApplied={(commitId) => {
            setCommitId(commitId);
            void refreshRepo();
          }}
          onClose={() => setMergeOpen(false)}
        />
      )}
    </div>
  );
}
