import { useCallback, useEffect, useRef, useState } from "react";
import { LuCornerUpLeft } from "react-icons/lu";
import { api, type BranchBudget, type Message } from "@/lib/api";
import { commitsOnBranch } from "../git/branchCommits";
import { AgentMark, Field } from "../primitives";
import GovernorPanel from "../chat/GovernorPanel";
import PendingChanges from "../chat/PendingChanges";
import { isReady } from "../chat/providerStatus";
import { brandFor } from "../providers";
import DeleteConversationDialog from "../chat/DeleteConversationDialog";
import NewConversationDialog, { type NewConversationInput } from "../chat/NewConversationDialog";
import ChatRail, { type ChatConversation, type ConversationMode } from "../rail/ChatRail";
import ChatView from "../views/ChatView";
import { useWorkbench } from "../WorkbenchContext";
import { FeaturePorts } from "../FeaturePorts";

const CONVERSATION_PREFIXES: ConversationMode[] = ["chat", "council", "research", "image"];

export default function ChatFeature() {
  const { providers, sessions, snapshot, setModel, tab, openProviderDialog, refreshRepo, refresh, refreshTrash, revision, model, setPickerOpen, repoError, providersError, sessionsError } = useWorkbench();
  const branches = snapshot?.branches ?? [];
  const commits = [...(snapshot?.commits ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));

  const [barError, setBarError] = useState<string | null>(null);

  const [chatBranch, setChatBranch] = useState("");

  const [chatFilter, setChatFilter] = useState<ConversationMode | "all">("all");

  const [chatStaging, setChatStaging] = useState<Record<string, Message[]>>({});

  const [newConversationOpen, setNewConversationOpen] = useState(false);

  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);

  const [offlineOk, setOfflineOk] = useState(false);

  const [budget, setBudget] = useState<BranchBudget | null>(null);

  const [budgetTick, setBudgetTick] = useState(0);

  const readyChatCount = providers.filter((p) => p.capability === "chat" && isReady(p)).length;

  const readyImageCount = providers.filter((p) => p.capability === "image" && isReady(p)).length;

  const readySearchCount = providers.filter((p) => p.capability === "search" && isReady(p)).length;

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
        // A conversation is a branch bound to a chat session, or one carrying a
        // conversation prefix (chat/council/research/image). Every other branch
        // — runs, worktrees, plain git branches — inherits the messages of the
        // history it forked from, so "has messages" (or being the current
        // branch) never makes a code branch a conversation.
        (chatSessionsByBranch.has(conversation.name) || conversation.mode !== "other"),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const chatSession = chatSessionsByBranch.get(chatBranch) ?? null;

  const chatSessionId = chatSession?.id ?? null;

  useEffect(() => {
    if (!snapshot) return;
    setChatBranch((current) =>
      current && snapshot.branches.some((branch) => branch.name === current)
        ? current
        : snapshot.current_branch || snapshot.branches[0]?.name || "",
    );
  }, [snapshot]);

  useEffect(() => {
    if (providers.length === 0) return;
    const current = model;
    // Honour a restored/saved pick as long as its provider and model exist.
    if (current.providerId) {
      const existing = providers.find((provider) => provider.id === current.providerId);
      if (
        existing &&
        (existing.models.length === 0 ||
          existing.models.includes(current.modelId) ||
          current.modelId === existing.default_model)
      ) {
        return;
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
    if (!pick) return;
    const preferred =
      pick.default_model && pick.models.includes(pick.default_model)
        ? pick.default_model
        : pick.models[0];
    setModel({ providerId: pick.id, modelId: preferred });
  }, [providers, model, setModel]);

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

  const promptedForProvider = useRef(false);

  useEffect(() => {
    if (promptedForProvider.current || tab !== "chat") return;
    if (providers.length === 0) return;
    promptedForProvider.current = true;
    if (readyChatCount === 0) openProviderDialog("chat");
  }, [tab, providers.length, readyChatCount, openProviderDialog]);

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

  const deleteConversation = useCallback(
    async (name: string) => {
      const session = sessions.find(
        (entry) => entry.kind === "chat" && entry.branch === name,
      );
      try {
        // Move the branch first. If it is the current branch (or another
        // request changed repository state), the API can reject here without
        // leaving a deleted session pointing at a visible branch.
        await api.deleteBranch(name);
        if (session) await api.deleteSession(session.id);
        if (chatBranch === name) setChatBranch(snapshot?.current_branch ?? "");
        await Promise.all([refreshRepo(), refresh(), refreshTrash()]);
        setBarError(null);
      } catch (cause) {
        setBarError(cause instanceof Error ? cause.message : "Could not delete the conversation");
      }
    },
    [sessions, chatBranch, snapshot, refreshRepo, refresh, refreshTrash],
  );

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
  const rail = () => {
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
  };

  const view = () => {
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
  };

  const dock = () => {
    {
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
  };

  const dialogs = () => <>{newConversationOpen && (
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
    )}</>;
  return <FeaturePorts id="chat"
    title={"Conversation"}
    rail={rail}
    view={view}
    dock={dock}
    dialogs={dialogs}
    onDismissDialogs={() => { setNewConversationOpen(false); setConversationToDelete(null); }}
    hasModal={newConversationOpen || conversationToDelete !== null}
    notice={barError ?? repoError ?? providersError ?? sessionsError} />;
}
