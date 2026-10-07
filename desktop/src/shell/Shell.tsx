import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuCommand, LuCornerUpLeft, LuMoon, LuPanelRight, LuSun, LuX } from "react-icons/lu";

import {
  api,
  type BranchBudget,
  type Message,
  type ProviderCapability,
  type Session,
  type Task,
} from "@/lib/api";
import { NAMED_AGENTS, type NamedAgent } from "../mock/fixtures";
import type { Asset } from "../../shared/assets";
import { ROLE_BY_ID, roleFor, roleSkills } from "../../shared/roles";
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
import PendingChanges from "./chat/PendingChanges";
import { isReady } from "./chat/providerStatus";
import { useProviders } from "./chat/useProviders";
import { brandFor, type ModelSelection } from "./providers";
import TopNav, { type TabDef, type TabId } from "./TopNav";
import DeleteConversationDialog from "./chat/DeleteConversationDialog";
import NewConversationDialog, {
  type NewConversationInput,
} from "./chat/NewConversationDialog";
import ProjectsRail from "./rail/ProjectsRail";
import ChatRail, { type ChatConversation, type ConversationMode } from "./rail/ChatRail";
import GitRail from "./rail/GitRail";
import RosterRail from "./rail/RosterRail";
import { useFleet } from "./terminal/useFleet";
import { useMergeQueue } from "./terminal/useMergeQueue";
import { useSessions } from "./terminal/useSessions";
import PaneCanvas, { type PaneLayout } from "./terminal/PaneCanvas";
import HarnessLimitsPanel from "./terminal/HarnessLimitsPanel";
import { useLimits } from "./terminal/useLimits";
import TaskDetail from "./team/TaskDetail";
import TaskForm from "./team/TaskForm";
import TeamMessages from "./team/TeamMessages";
import TeamRail from "./team/TeamRail";
import { useTeam } from "./team/useTeam";
import AgentView from "./views/AgentView";
import ApiRail from "./rail/ApiRail";
import ApiView from "./views/ApiView";
import { useApiClient } from "./api/useApiClient";
import EndpointsRail from "./rail/EndpointsRail";
import EndpointsView from "./views/EndpointsView";
import EndpointOrigin from "./endpoints/EndpointOrigin";
import { useEndpoints } from "./endpoints/useEndpoints";
import ChatView from "./views/ChatView";
import CodeView from "./views/CodeView";
import AssetsRail, { type AssetFilter } from "./rail/AssetsRail";
import BrowserRail from "./rail/BrowserRail";
import BrowserView from "./views/BrowserView";
import EditorRail from "./rail/EditorRail";
import EditorView from "./views/EditorView";
import AssetsView from "./views/AssetsView";
import AssetDetails from "./assets/AssetDetails";
import AssetPreview from "./assets/AssetPreview";
import DeleteAssetDialog from "./assets/DeleteAssetDialog";
import AssetAgentPanel from "./assets/AssetAgentPanel";
import NewFolderDialog from "./assets/NewFolderDialog";
import { useAssets } from "./assets/useAssets";
import GitView, { type CommitFilter } from "./views/GitView";
import StorageRail, { type StorageCategory } from "./rail/StorageRail";
import StorageView, { branchKey, closedKey, sessionKey } from "./views/StorageView";
import ConfirmDialog from "./storage/ConfirmDialog";
import {
  clearClosed,
  loadClosed,
  loadOpenPanes,
  pushClosed,
  removeClosed,
  saveOpenPanes,
  type ClosedPane,
} from "./storage/recentlyClosed";
import { useTrash } from "./storage/useTrash";
import TeamView from "./views/TeamView";
import UsageView from "./views/UsageView";
import ProjectPicker from "./workspace/ProjectPicker";
import { useProjects } from "./workspace/useProjects";

type Theme = "dark" | "light";

const TAB_IDS: TabId[] = [
  "chat",
  "code",
  "assets",
  "browser",
  "editor",
  "api",
  "endpoints",
  "agent",
  "git",
  "usage",
  "storage",
];

/** Time windows for the Usage tab. */
const USAGE_PERIODS: Array<{ label: string; days: number | undefined }> = [
  { label: "All time", days: undefined },
  { label: "Last 7 days", days: 7 },
  { label: "Today", days: 1 },
];

/** The Code tab's two surfaces: one run at a time, or a task graph. */
const MODE_OPTIONS = [
  { value: "single" as const, label: "Single" },
  { value: "team" as const, label: "Team" },
];

/** Branch-name prefixes that tag a conversation with its surface. */
const CONVERSATION_PREFIXES: ConversationMode[] = ["chat", "council", "research", "image"];

/** The chat model the user last picked, remembered across refreshes/restarts. */
const MODEL_KEY = "cg-chat-model";

function readStoredModel(): ModelSelection | null {
  try {
    const raw = window.localStorage.getItem(MODEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ModelSelection>;
    if (
      typeof parsed.providerId === "string" &&
      parsed.providerId &&
      typeof parsed.modelId === "string"
    ) {
      return { providerId: parsed.providerId, modelId: parsed.modelId };
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

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
  const {
    workspace,
    projects,
    activePath,
    error: workspaceError,
    choose,
    pickLocation,
    create: createWorkspace,
    use: useProject,
    forget: forgetProject,
  } = useProjects();
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

  // ---- Storage tab: trashed runs/branches + panes closed this session ----
  const {
    sessions: trashSessions,
    branches: trashBranches,
    error: trashError,
    refresh: refreshTrash,
  } = useTrash();
  const [trashCategory, setTrashCategory] = useState<StorageCategory>("all");
  const [trashQuery, setTrashQuery] = useState("");
  const [trashSelected, setTrashSelected] = useState<string | null>(null);
  const [closedPanes, setClosedPanes] = useState<ClosedPane[]>(() => loadClosed());
  const [purgeTarget, setPurgeTarget] = useState<{
    kind: "session" | "branch";
    key: string;
    label: string;
  } | null>(null);
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false);

  // ---- Chat operates on a real branch; Agent still reads fixtures ----
  const [chatBranch, setChatBranch] = useState("");
  // ---- Assets tab: the app-level asset library ----
  const assets = useAssets();
  const [assetId, setAssetId] = useState<string | null>(null);
  const [assetKind, setAssetKind] = useState<AssetFilter>("all");
  const [assetQuery, setAssetQuery] = useState("");
  const [assetTag, setAssetTag] = useState<string | null>(null);
  const [assetPreview, setAssetPreview] = useState<Asset | null>(null);
  const [assetDelete, setAssetDelete] = useState<Asset | null>(null);
  const [assetFolder, setAssetFolder] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  /** Browser tab: a navigation asked for from the rail. */
  const [browserRequest, setBrowserRequest] = useState<{ url: string; nonce: number } | null>(null);
  /** Editor tab: bumped to tell EditorView to (re)check the sidecar. */
  const [editorNonce, setEditorNonce] = useState(0);
  const bumpEditor = useCallback(() => setEditorNonce((value) => value + 1), []);
  const [chatFilter, setChatFilter] = useState<ConversationMode | "all">("all");
  /** Usage tab time window: undefined = all time. */
  const [usageDays, setUsageDays] = useState<number | undefined>(undefined);
  /** Staged (uncommitted) messages per chat session id. */
  const [chatStaging, setChatStaging] = useState<Record<string, Message[]>>({});
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);
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
  const apiClient = useApiClient();
  const endpointsState = useEndpoints(activePath ?? null);
  const {
    providers,
    error: providersError,
    add: addProvider,
    remove: removeProvider,
    test: testProvider,
    fetchModels: fetchProviderModels,
  } = useProviders();
  const [model, setModel] = useState<ModelSelection>(
    () => readStoredModel() ?? { providerId: "", modelId: "" },
  );
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
  const activeAgent = agents.find((agent) => agent.id === agentId) ?? agents[0];

  // Each CLI harness's own account limits (cmd's 5-hour/weekly windows, …).
  const { limits, loading: limitsLoading, refresh: refreshLimits } = useLimits(tab === "code");
  const limitsByHarness = new Map(limits.map((entry) => [entry.harness, entry]));
  const runHarness = activeSession?.agent ?? "shell";

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

  // Chat conversations are the repo's real branches — but only the ones that are
  // conversations. Terminal-run branches (owned by a terminal session) belong to
  // the Code tab; chat sessions are conversations and stay here.
  const chatBranchHead =
    branches.find((branch) => branch.name === chatBranch)?.head_commit_id ?? null;
  const terminalSessionBranches = new Set(
    sessions.filter((session) => session.kind !== "chat").map((session) => session.branch),
  );
  const chatSessionsByBranch = new Map(
    sessions
      .filter((session) => session.kind === "chat")
      .map((session) => [session.branch, session]),
  );
  const modeOf = (name: string): ConversationMode => {
    const prefix = name.split("/")[0];
    return (CONVERSATION_PREFIXES as readonly string[]).includes(prefix)
      ? (prefix as ConversationMode)
      : "other";
  };
  const chatConversations: ChatConversation[] = branches
    .map((branch) => {
      const list = commitsOnBranch(commits, branch.head_commit_id);
      const session = chatSessionsByBranch.get(branch.name);
      return {
        name: branch.name,
        head: branch.head_commit_id,
        messages: list.reduce((total, commit) => total + commit.messages.length, 0),
        tokens: list.reduce((total, commit) => total + commit.token_count, 0),
        updatedAt: list[0]?.created_at ?? "",
        mode: modeOf(branch.name),
        pending: session ? (chatStaging[session.id]?.length ?? 0) : 0,
        deletable: branch.name !== snapshot?.current_branch && branch.name !== "main",
      };
    })
    .filter(
      (conversation) =>
        !terminalSessionBranches.has(conversation.name) &&
        (conversation.messages > 0 ||
          conversation.mode !== "other" ||
          conversation.name === snapshot?.current_branch),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const chatSession = chatSessionsByBranch.get(chatBranch) ?? null;
  const chatSessionId = chatSession?.id ?? null;

  // Keep the chat branch valid; default to the repo's current branch.
  useEffect(() => {
    if (!snapshot) return;
    setChatBranch((current) =>
      current && snapshot.branches.some((branch) => branch.name === current)
        ? current
        : snapshot.current_branch || snapshot.branches[0]?.name || "",
    );
  }, [snapshot]);

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

  // Keep the user's last model while it is still valid; otherwise pick a working
  // default once the registry loads (a configured, non-mock provider wins; the
  // offline mock is the fallback).
  useEffect(() => {
    if (providers.length === 0) return;
    setModel((current) => {
      // Honour a restored/saved pick as long as its provider and model exist.
      if (current.providerId) {
        const existing = providers.find((provider) => provider.id === current.providerId);
        if (
          existing &&
          (existing.models.length === 0 ||
            existing.models.includes(current.modelId) ||
            current.modelId === existing.default_model)
        ) {
          return current;
        }
      }
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
      const preferred =
        pick.default_model && pick.models.includes(pick.default_model)
          ? pick.default_model
          : pick.models[0];
      return { providerId: pick.id, modelId: preferred };
    });
  }, [providers]);

  // Remember the pick so a refresh or reopen keeps the user's model.
  useEffect(() => {
    if (!model.providerId) return;
    try {
      window.localStorage.setItem(MODEL_KEY, JSON.stringify(model));
    } catch {
      // storage can be unavailable; the selection still applies this session
    }
  }, [model]);

  // Real context size of the chat branch (refresh after each committed turn).
  useEffect(() => {
    if (!chatBranch) return;
    let alive = true;
    void api
      .branchBudget(chatBranch)
      .then((value) => {
        if (alive) setBudget(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [chatBranch, budgetTick]);

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

  /**
   * Create an isolated conversation: a branch forked from the repo **root** (so
   * no other conversation's messages leak in) plus a chat session that owns its
   * staging buffer. Optionally seed a summary imported from another conversation.
   */
  const createConversation = useCallback(
    async (input: NewConversationInput) => {
      const root = commits.find((commit) => commit.parent_ids.length === 0)?.id ?? null;
      if (!root) throw new Error("Repository has no root commit");
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const name = `${input.mode}/${input.label || stamp}`;
      try {
        await api.createBranch(name, root);
        await api.createSession({ name, kind: "chat", branch: name, autoCommit: false });
        if (input.seedFrom) {
          const sourceHead =
            branches.find((branch) => branch.name === input.seedFrom)?.head_commit_id ?? null;
          const summaries = sourceHead
            ? commitsOnBranch(commits, sourceHead)
                .map((commit) => commit.summary)
                .filter((summary): summary is string => Boolean(summary))
                .reverse()
            : [];
          if (summaries.length > 0) {
            await api.commit({
              messages: [
                {
                  role: "system",
                  content: `Imported from ${input.seedFrom}:\n${summaries.join("\n")}`,
                },
              ],
              branch: name,
              summary: `import from ${input.seedFrom}`,
            });
          }
        }
        await Promise.all([refreshRepo(), refresh()]);
        setChatBranch(name);
        setChatFilter("all");
        setBarError(null);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not create the conversation");
        throw cause;
      }
    },
    [commits, branches, refreshRepo, refresh],
  );

  /** Delete a conversation's pointer and its chat session; commits survive. */
  const deleteConversation = useCallback(
    async (name: string) => {
      const session = sessions.find(
        (entry) => entry.kind === "chat" && entry.branch === name,
      );
      try {
        if (session) await api.deleteSession(session.id);
        await api.deleteBranch(name);
        if (chatBranch === name) setChatBranch(snapshot?.current_branch ?? "");
        await Promise.all([refreshRepo(), refresh(), refreshTrash()]);
        setBarError(null);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not delete the conversation");
      }
    },
    [sessions, chatBranch, snapshot, refreshRepo, refresh, refreshTrash],
  );

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

  // Load staged (uncommitted) messages for every chat conversation, so the rail
  // can show a pending count and the dock can list what is about to be committed.
  const chatSessionIds = sessions
    .filter((session) => session.kind === "chat")
    .map((session) => session.id);
  const chatSessionKey = chatSessionIds.join(",");
  useEffect(() => {
    const ids = chatSessionKey ? chatSessionKey.split(",") : [];
    if (ids.length === 0) {
      setChatStaging({});
      return;
    }
    let alive = true;
    void Promise.all(ids.map((id) => api.staging(id).then((items) => [id, items] as const)))
      .then((entries) => {
        if (alive) setChatStaging(Object.fromEntries(entries));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [chatSessionKey, budgetTick, revision]);

  const openSession = useCallback((session: Session) => {
    setOpenIds((current) => (current.includes(session.id) ? current : [...current, session.id]));
    setActiveId(session.id);
    setSummary("");
    setBarError(null);
  }, []);

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
    // Remember it so it can be reopened from Storage → Recently closed.
    setClosedPanes(
      pushClosed({
        id: session.id,
        name: session.name,
        kind: session.kind,
        at: new Date().toISOString(),
      }),
    );
  }, []);

  const reopenClosed = useCallback(
    (pane: ClosedPane) => {
      setClosedPanes(removeClosed(pane.id));
      const session = sessions.find((entry) => entry.id === pane.id);
      if (session) openSession(session);
      else setBarError("That run no longer exists — it may have been deleted.");
    },
    [openSession, sessions],
  );

  const restoreTrashedSession = useCallback(
    async (session: Session) => {
      try {
        await api.restoreSession(session.id);
        setBarError(null);
        await Promise.all([refresh(), refreshTrash()]);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not restore run");
      }
    },
    [refresh, refreshTrash],
  );

  const restoreTrashedBranch = useCallback(
    async (branch: { name: string }) => {
      try {
        await api.restoreBranch(branch.name);
        setBarError(null);
        await Promise.all([refreshRepo(), refreshTrash()]);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not restore branch");
      }
    },
    [refreshRepo, refreshTrash],
  );

  const purgeSelected = useCallback(async () => {
    if (!purgeTarget) return;
    if (purgeTarget.kind === "session") await api.deleteSession(purgeTarget.key, true);
    else await api.deleteBranch(purgeTarget.key, true);
    setTrashSelected(null);
    await Promise.all([refresh(), refreshRepo(), refreshTrash()]);
  }, [purgeTarget, refresh, refreshRepo, refreshTrash]);

  const emptyTrash = useCallback(async () => {
    await Promise.all([
      ...trashSessions.map((session) => api.deleteSession(session.id, true)),
      ...trashBranches.map((branch) => api.deleteBranch(branch.name, true)),
    ]);
    setTrashSelected(null);
    await Promise.all([refresh(), refreshRepo(), refreshTrash()]);
  }, [trashSessions, trashBranches, refresh, refreshRepo, refreshTrash]);

  // Reopen the panes that were open before the last reload, once runs load.
  const restoredPanes = useRef(false);
  useEffect(() => {
    if (restoredPanes.current || sessions.length === 0) return;
    restoredPanes.current = true;
    const valid = loadOpenPanes().filter((id) => sessions.some((session) => session.id === id));
    if (valid.length > 0) {
      setOpenIds(valid);
      setActiveId(valid[valid.length - 1]);
    }
  }, [sessions]);

  // Persist open panes so they survive a reload. Only after the restore pass, so
  // the empty initial state never clobbers the stored ids.
  useEffect(() => {
    if (!restoredPanes.current) return;
    saveOpenPanes(openIds);
  }, [openIds]);

  const deleteRun = useCallback(
    async (session: Session) => {
      setOpenIds((current) => current.filter((id) => id !== session.id));
      setActiveId((current) => (current === session.id ? null : current));
      try {
        await remove(session.id);
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
    { id: "assets", label: "Assets" },
    { id: "browser", label: "Browser" },
    { id: "editor", label: "Editor" },
    { id: "api", label: "API" },
    { id: "endpoints", label: "Endpoints" },
    { id: "agent", label: "Agent" },
    { id: "git", label: "Git" },
    { id: "usage", label: "Usage" },
    { id: "storage", label: "Storage" },
  ];

  // ---- Assets tab: counts, folders, tags and the filtered gallery ----
  const assetCounts = useMemo<Record<AssetFilter, number>>(() => {
    const counts: Record<AssetFilter, number> = {
      all: assets.assets.length,
      image: 0,
      video: 0,
      audio: 0,
      doc: 0,
      other: 0,
    };
    for (const asset of assets.assets) counts[asset.kind] += 1;
    return counts;
  }, [assets.assets]);

  const assetTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const asset of assets.assets) {
      for (const tag of asset.tags) map.set(tag, (map.get(tag) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [assets.assets]);

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const folder of assets.folders) {
      counts[folder] = assets.assets.filter(
        (asset) => asset.folder === folder || asset.folder.startsWith(`${folder}/`),
      ).length;
    }
    return counts;
  }, [assets.assets, assets.folders]);

  const filteredAssets = useMemo(() => {
    const query = assetQuery.trim().toLowerCase();
    return assets.assets.filter((asset) => {
      if (
        assetFolder !== null &&
        !(asset.folder === assetFolder || asset.folder.startsWith(`${assetFolder}/`))
      ) {
        return false;
      }
      if (assetKind !== "all" && asset.kind !== assetKind) return false;
      if (assetTag && !asset.tags.includes(assetTag)) return false;
      if (
        query &&
        !asset.name.toLowerCase().includes(query) &&
        !asset.tags.some((tag) => tag.toLowerCase().includes(query))
      ) {
        return false;
      }
      return true;
    });
  }, [assets.assets, assetFolder, assetKind, assetTag, assetQuery]);

  const selectedAsset = assets.assets.find((asset) => asset.id === assetId) ?? null;

  const rail = () => {
    switch (tab) {
      case "chat":
        return (
          <ChatRail
            conversations={chatConversations}
            selectedBranch={chatBranch}
            filter={chatFilter}
            onFilter={setChatFilter}
            onSelect={setChatBranch}
            onNew={() => setNewConversationOpen(true)}
            onDelete={(name) => setConversationToDelete(name)}
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
          <ProjectsRail
            sessions={sessions.filter((session) => session.kind === "terminal")}
            fleet={fleet}
            openIds={openIds}
            activeId={activeId}
            limits={Object.fromEntries(limitsByHarness)}
            projects={projects}
            activePath={activePath}
            onSelect={openSession}
            onNew={startRun}
            onDelete={(session) => void deleteRun(session)}
            onUseProject={(path) => void useProject(path)}
            onForgetProject={(path) => void forgetProject(path)}
            onChooseProject={() => setProjectOpen(true)}
          />
        );
      case "assets":
        return (
          <AssetsRail
            counts={assetCounts}
            kind={assetKind}
            onKind={setAssetKind}
            query={assetQuery}
            onQuery={setAssetQuery}
            folders={assets.folders}
            folderCounts={folderCounts}
            folder={assetFolder}
            onFolder={setAssetFolder}
            onNewFolder={() => setNewFolderOpen(true)}
            tags={assetTags}
            activeTag={assetTag}
            onTag={setAssetTag}
          />
        );
      case "browser":
        return <BrowserRail onOpen={(url) => setBrowserRequest({ url, nonce: Date.now() })} />;
      case "editor":
        return (
          <EditorRail
            reloadKey={editorNonce}
            activePath={activePath}
            onStarted={bumpEditor}
            onOpenFolder={() => setProjectOpen(true)}
          />
        );
      case "api":
        return <ApiRail client={apiClient} />;
      case "endpoints":
        return <EndpointsRail state={endpointsState} />;
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
          />
        );
      case "usage":
        return (
          <nav className="cg-rail" aria-label="Usage period">
            <div className="cg-rail-head">
              <h2>Period</h2>
            </div>
            {USAGE_PERIODS.map((period) => (
              <button
                key={period.label}
                type="button"
                className="cg-row"
                aria-current={usageDays === period.days}
                onClick={() => setUsageDays(period.days)}
              >
                <span className="cg-row-title">{period.label}</span>
              </button>
            ))}
          </nav>
        );
      case "storage":
        return (
          <StorageRail
            sessions={trashSessions}
            branches={trashBranches}
            closed={closedPanes}
            category={trashCategory}
            onCategory={setTrashCategory}
            query={trashQuery}
            onQuery={setTrashQuery}
          />
        );
    }
  };

  const view = () => {
    switch (tab) {
      case "chat":
        return (
          <ChatView
            selection={model}
            providers={providers}
            branch={chatBranch}
            sessionId={chatSessionId}
            commitId={chatBranchHead}
            onPickModel={() => setPickerOpen(true)}
            onAddProvider={openProviderDialog}
            onCommitted={() => setBudgetTick((value) => value + 1)}
            onStaged={() => setBudgetTick((value) => value + 1)}
            readyChatCount={readyChatCount}
            readyImageCount={readyImageCount}
            readySearchCount={readySearchCount}
            offlineOk={offlineOk}
            onUseOffline={() => setOfflineOk(true)}
          />
        );
      case "assets":
        return (
          <AssetsView
            items={filteredAssets}
            selectedId={assetId}
            loading={assets.loading}
            error={assets.error}
            folder={assetFolder}
            onSelect={setAssetId}
            onOpen={setAssetPreview}
            onImport={assets.importAssets}
            onImportFolder={assets.importFolder}
            onAgent={() => setAgentOpen(true)}
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
            onFilter={setFilter}
            tags={snapshot?.tags ?? []}
            loading={repoLoading}
            onRefresh={() => void refreshRepo()}
          />
        );
      case "usage":
        return <UsageView days={usageDays} providers={providers} />;
      case "storage":
        return (
          <StorageView
            sessions={trashSessions}
            branches={trashBranches}
            closed={closedPanes}
            category={trashCategory}
            query={trashQuery}
            selectedKey={trashSelected}
            onSelect={setTrashSelected}
            onRestoreSession={(session) => void restoreTrashedSession(session)}
            onRestoreBranch={(branch) => void restoreTrashedBranch(branch)}
            onPurgeSession={(session) =>
              setPurgeTarget({ kind: "session", key: session.id, label: session.name })
            }
            onPurgeBranch={(branch) =>
              setPurgeTarget({ kind: "branch", key: branch.name, label: branch.name })
            }
            onReopen={reopenClosed}
            onClearClosed={() => setClosedPanes(clearClosed())}
          />
        );
      case "api":
        return <ApiView client={apiClient} />;
      case "endpoints":
        return <EndpointsView state={endpointsState} />;
      default:
        return null;
    }
  };

  const dock = () => {
    switch (tab) {
      case "chat": {
        const chatProvider = providers.find((provider) => provider.id === model.providerId);
        const chatBrand = brandFor(model.providerId, chatProvider?.label ?? "");
        const chatHead = chatBranchHead;
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
            <PendingChanges
              sessionId={chatSessionId}
              staged={chatSessionId ? (chatStaging[chatSessionId] ?? []) : []}
              onChanged={() => {
                setBudgetTick((value) => value + 1);
                void refreshRepo();
              }}
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
      case "assets":
        return selectedAsset ? (
          <AssetDetails
            asset={selectedAsset}
            folders={assets.folders}
            onUpdate={(patch) => assets.update(selectedAsset.id, patch)}
            onReveal={() => void window.contextgit?.assetsReveal(selectedAsset.id)}
            onDelete={() => setAssetDelete(selectedAsset)}
          />
        ) : (
          <p className="cg-empty-note">Select an asset to inspect it.</p>
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
      case "api": {
        const sent = apiClient.response;
        return sent ? (
          <div className="cg-fields">
            <Field label="Status">
              {sent.status} {sent.reason}
            </Field>
            <Field label="Time">{sent.elapsed_ms} ms</Field>
            <Field label="Size">{sent.size} bytes</Field>
            <Field label="Headers">{Object.keys(sent.headers).length}</Field>
            <Field label="URL">
              <span className="cg-mono">{sent.url}</span>
            </Field>
          </div>
        ) : (
          <p className="cg-empty-note">Send a request to inspect the response here.</p>
        );
      }
      case "endpoints":
        return endpointsState.active ? (
          <EndpointOrigin endpoint={endpointsState.active} />
        ) : (
          <p className="cg-empty-note">Pick an endpoint to see where it came from.</p>
        );
      case "storage": {
        const selected = trashSelected;
        const session = selected?.startsWith("session:")
          ? trashSessions.find((entry) => sessionKey(entry.id) === selected)
          : undefined;
        const branch = selected?.startsWith("branch:")
          ? trashBranches.find((entry) => branchKey(entry.name) === selected)
          : undefined;
        const pane = selected?.startsWith("closed:")
          ? closedPanes.find((entry) => closedKey(entry.id) === selected)
          : undefined;
        if (session) {
          return (
            <div className="cg-fields">
              <Field label="Type">{session.kind === "chat" ? "Conversation" : "Run"}</Field>
              <Field label="Branch">{session.branch}</Field>
              <Field label="Agent">{session.agent ?? "—"}</Field>
              <Field label="Project">{session.project_path ?? "—"}</Field>
              <Field label="Moved to Storage">
                {session.deleted_at ? new Date(session.deleted_at).toLocaleString() : "—"}
              </Field>
            </div>
          );
        }
        if (branch) {
          return (
            <div className="cg-fields">
              <Field label="Type">Branch</Field>
              <Field label="Head">
                <span className="cg-mono">{branch.head_commit_id.slice(0, 7)}</span>
              </Field>
              <Field label="Moved to Storage">
                {branch.deleted_at ? new Date(branch.deleted_at).toLocaleString() : "—"}
              </Field>
            </div>
          );
        }
        if (pane) {
          return (
            <div className="cg-fields">
              <Field label="Type">Closed pane</Field>
              <Field label="Run">{pane.name}</Field>
              <Field label="Closed">{new Date(pane.at).toLocaleString()}</Field>
            </div>
          );
        }
        return (
          <p className="cg-empty-note">
            Select an item to inspect it, then restore or delete it for good.
          </p>
        );
      }
    }
  };

  const bottomBar = () => {
    if (tab === "assets") {
      // No commit bar: the gallery is the bottom edge.
      return null;
    }
    if (tab === "browser") {
      // No commit bar: the page is the bottom edge.
      return null;
    }
    if (tab === "editor") {
      // No commit bar: VS Code owns the bottom edge.
      return null;
    }
    if (tab === "api") {
      // No commit bar: the request editor owns the bottom edge.
      return null;
    }
    if (tab === "endpoints") {
      // No commit bar: the endpoint detail owns the bottom edge.
      return null;
    }
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
    if (tab === "storage") {
      const selected = trashSelected;
      const session = selected?.startsWith("session:")
        ? trashSessions.find((entry) => sessionKey(entry.id) === selected)
        : undefined;
      const branch = selected?.startsWith("branch:")
        ? trashBranches.find((entry) => branchKey(entry.name) === selected)
        : undefined;
      const pane = selected?.startsWith("closed:")
        ? closedPanes.find((entry) => closedKey(entry.id) === selected)
        : undefined;
      return (
        <footer className="cg-bottombar" aria-label="Storage actions">
          <span className="cg-bb-info">
            <strong>{session?.name ?? branch?.name ?? pane?.name ?? "Storage"}</strong>
            <span className="cg-view-sub">
              {trashSessions.length + trashBranches.length} recoverable
              {closedPanes.length > 0 ? ` · ${closedPanes.length} closed` : ""}
            </span>
          </span>
          <span className="cg-bb-actions cg-bb-end">
            <button
              type="button"
              className="cg-btn"
              disabled={!session && !branch && !pane}
              onClick={() => {
                if (pane) reopenClosed(pane);
                else if (session) void restoreTrashedSession(session);
                else if (branch) void restoreTrashedBranch(branch);
              }}
            >
              {pane ? "Reopen" : "Restore"}
            </button>
            <button
              type="button"
              className="cg-btn"
              data-variant="danger"
              disabled={!session && !branch}
              onClick={() => {
                if (session) {
                  setPurgeTarget({ kind: "session", key: session.id, label: session.name });
                } else if (branch) {
                  setPurgeTarget({ kind: "branch", key: branch.name, label: branch.name });
                }
              }}
            >
              Delete forever
            </button>
            <button
              type="button"
              className="cg-btn"
              disabled={trashSessions.length === 0 && trashBranches.length === 0}
              onClick={() => setEmptyTrashOpen(true)}
            >
              Empty Storage
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
          : tab === "assets"
            ? "Asset"
            : tab === "browser"
              ? "Page"
              : tab === "editor"
                ? "Editor"
                : tab === "storage"
                  ? "Storage"
                  : tab === "api"
                    ? "Response"
                    : tab === "endpoints"
                      ? "Origin"
                      : "Commit";

  const notice =
    sessionsError ??
    barError ??
    repoError ??
    workspaceError ??
    fleetError ??
    teamError ??
    mergeQueue.error ??
    providersError ??
    trashError;

  // A native WebContentsView (Browser/Editor) is layered above the DOM, so it
  // would cover any dialog. Hide those views while a modal is open.
  const overlayOpen =
    pickerOpen ||
    providerDialog !== null ||
    taskForm !== null ||
    projectOpen ||
    agentDialog !== null ||
    diffOpen ||
    branchOpen ||
    branchToDelete !== null ||
    newConversationOpen ||
    conversationToDelete !== null ||
    mergeOpen ||
    assetPreview !== null ||
    assetDelete !== null ||
    newFolderOpen ||
    agentOpen ||
    purgeTarget !== null ||
    emptyTrashOpen;

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
          {/* Browser stays mounted too, so its page survives tab switches. */}
          <div className="cg-view" data-active={tab === "browser"}>
            <BrowserView
              active={tab === "browser"}
              request={browserRequest}
              obscured={overlayOpen}
            />
          </div>
          {/* Editor stays mounted too, so VS Code survives tab switches. */}
          <div className="cg-view" data-active={tab === "editor"}>
            <EditorView
              active={tab === "editor"}
              nonce={editorNonce}
              obscured={overlayOpen}
              onStarted={bumpEditor}
            />
          </div>
          {tab !== "code" && tab !== "browser" && tab !== "editor" && (
            <div className="cg-view" data-active>
              {view()}
            </div>
          )}
        </main>
        {dockOpen && tab !== "usage" && tab !== "browser" && tab !== "editor" && (
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
            void refreshTrash();
          }}
          onClose={() => setBranchToDelete(null)}
        />
      )}

      {newConversationOpen && (
        <NewConversationDialog
          defaultMode="chat"
          sources={chatConversations.map((conversation) => conversation.name)}
          onCreate={createConversation}
          onClose={() => setNewConversationOpen(false)}
        />
      )}

      {conversationToDelete && (
        <DeleteConversationDialog
          name={conversationToDelete}
          onConfirm={() => deleteConversation(conversationToDelete)}
          onClose={() => setConversationToDelete(null)}
        />
      )}

      {purgeTarget && (
        <ConfirmDialog
          title={purgeTarget.kind === "branch" ? "Delete branch forever" : "Delete forever"}
          subtitle={purgeTarget.label}
          body={
            purgeTarget.kind === "branch"
              ? `Permanently drop the "${purgeTarget.label}" branch pointer. Every commit stays in the repository.`
              : `Permanently delete "${purgeTarget.label}". Its worktree is removed when clean; its commits and branch stay in the repository.`
          }
          confirmLabel="Delete forever"
          onConfirm={purgeSelected}
          onClose={() => setPurgeTarget(null)}
        />
      )}

      {emptyTrashOpen && (
        <ConfirmDialog
          title="Empty Storage"
          body={`Permanently delete ${trashSessions.length} run(s) and ${trashBranches.length} branch pointer(s). Every commit is kept.`}
          confirmLabel="Empty Storage"
          onConfirm={emptyTrash}
          onClose={() => setEmptyTrashOpen(false)}
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

      {assetPreview && (
        <AssetPreview asset={assetPreview} onClose={() => setAssetPreview(null)} />
      )}

      {assetDelete && (
        <DeleteAssetDialog
          asset={assetDelete}
          onConfirm={() => {
            const id = assetDelete.id;
            setAssetDelete(null);
            if (assetId === id) setAssetId(null);
            void assets.remove(id);
          }}
          onClose={() => setAssetDelete(null)}
        />
      )}

      {newFolderOpen && (
        <NewFolderDialog
          onCreate={(folder) => assets.createFolder(folder)}
          onClose={() => setNewFolderOpen(false)}
        />
      )}

      {agentOpen && (
        <AssetAgentPanel
          assets={assets.assets}
          onChanged={assets.refresh}
          onClose={() => setAgentOpen(false)}
        />
      )}
    </div>
  );
}
