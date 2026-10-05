import { useEffect, useMemo, useRef, useState } from "react";
import { LuCornerUpLeft } from "react-icons/lu";

import {
  api,
  streamCouncil,
  streamChat,
  streamImages,
  streamResearch,
  type BlameEntry,
  type CouncilEvent,
  type ImageEvent,
  type ProviderCapability,
  type ProviderInfo,
  type ResearchEvent,
  type Role,
} from "@/lib/api";

import {
  DEFAULT_CONTROLS,
  PROMPT_VERSIONS,
  type ChatMode,
  type ComposerControls,
  type ResearchMode,
} from "../../mock/chat";
import { brandFor, type ModelSelection } from "../providers";
import { AgentMark, Chip } from "../primitives";
import BlameSheet, { type BlameView } from "../chat/BlameSheet";
import ComposerModes, { councilMembers, type CouncilCandidate } from "../chat/ComposerModes";
import ConnectProviderCard from "../chat/ConnectProviderCard";
import { isReady } from "../chat/providerStatus";
import CouncilCard, { type CouncilMemberView } from "../chat/CouncilCard";
import ImageLab, { type ImageTile } from "../chat/ImageLab";
import ResearchRun, {
  type ResearchResultPayload,
  type ResearchSource,
  type StepState,
} from "../chat/ResearchRun";

type Entry =
  | { kind: "message"; role: Role; content: string }
  | {
      kind: "council";
      prompt: string;
      members: CouncilMemberView[];
      answers: string[];
      errors: Array<string | null>;
      kept: number | null;
    }
  | {
      kind: "research";
      mode: ResearchMode;
      steps: StepState[];
      sources: ResearchSource[];
      report: string;
      result: ResearchResultPayload | null;
      error: string | null;
      done: boolean;
    }
  | {
      kind: "image";
      versions: Array<{ version: number; text: string; note: string }>;
      tiles: ImageTile[];
      model: string;
      aspect: string;
    };

const IMAGE_PLACEHOLDER = PROMPT_VERSIONS[1].text;

/** Depth is the user's dial; these are the explicit budgets behind it. */
const RESEARCH_BUDGETS: Record<
  ComposerControls["depth"],
  { breadth: number; depth: number; maxPages: number }
> = {
  quick: { breadth: 2, depth: 1, maxPages: 3 },
  standard: { breadth: 3, depth: 2, maxPages: 6 },
  deep: { breadth: 4, depth: 3, maxPages: 10 },
};

export default function ChatView({
  selection,
  providers,
  branch,
  commitId,
  onPickModel,
  onAddProvider,
  onCommitted,
  readyChatCount,
  readyImageCount,
  readySearchCount,
  offlineOk,
  onUseOffline,
}: {
  selection: ModelSelection;
  providers: ProviderInfo[];
  /** The real repo branch the turn is committed to. */
  branch: string;
  /** The real commit the context is built from (null → the branch head). */
  commitId: string | null;
  onPickModel: () => void;
  onAddProvider: (capability: ProviderCapability, initialId?: string) => void;
  /** Called after a turn is committed, so the inspector can refresh. */
  onCommitted?: () => void;
  /** How many usable providers exist per capability (mock and bare rows excluded). */
  readyChatCount: number;
  readyImageCount: number;
  readySearchCount: number;
  /** The user chose to run against the offline mock for this session. */
  offlineOk: boolean;
  onUseOffline: () => void;
}) {
  const provider = providers.find((entry) => entry.id === selection.providerId);
  const brand = brandFor(selection.providerId, provider?.label ?? "");
  const modelLabel = selection.modelId;

  const chatProviders = useMemo(
    () =>
      providers.filter(
        (entry) => entry.capability === "chat" && (isReady(entry) || entry.kind === "mock"),
      ),
    [providers],
  );
  const imageProviders = useMemo(
    () =>
      providers.filter(
        (entry) => entry.capability === "image" && (isReady(entry) || entry.kind === "mock"),
      ),
    [providers],
  );
  const defaultSearch = useMemo(
    () =>
      providers.find(
        (entry) => entry.capability === "search" && (isReady(entry) || entry.kind === "mock"),
      ) ?? null,
    [providers],
  );

  const councilCandidates = useMemo<CouncilCandidate[]>(
    () =>
      chatProviders.flatMap((entry) => {
        const models =
          entry.models.length > 0 ? entry.models : entry.default_model ? [entry.default_model] : [];
        return models.map((model) => ({
          key: `${entry.id}:${model}`,
          providerId: entry.id,
          modelId: model,
          label: entry.label,
          // `:free` is OpenRouter's free tier; local/offline cost nothing.
          free: entry.kind === "local" || entry.kind === "mock" || /:free\b/i.test(model),
        }));
      }),
    [chatProviders],
  );

  /**
   * Models a council can actually call: from connected (non-mock) chat
   * providers. A council is several *models*, which may all live on one
   * provider (e.g. three OpenRouter models), so count models not providers.
   */
  const readyCouncilModels = useMemo(
    () =>
      providers
        .filter((entry) => entry.capability === "chat" && entry.kind !== "mock" && isReady(entry))
        .reduce(
          (total, entry) => total + Math.max(entry.models.length, entry.default_model ? 1 : 0),
          0,
        ),
    [providers],
  );

  const [entries, setEntries] = useState<Entry[]>([]);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [controls, setControls] = useState<ComposerControls>(DEFAULT_CONTROLS);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [streamed, setStreamed] = useState("");
  const [blame, setBlame] = useState<BlameView | null>(null);

  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const accumulated = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const blameCache = useRef<BlameEntry[] | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The transcript is the branch's real committed context, never sample data.
  useEffect(() => {
    let alive = true;
    blameCache.current = null;
    void (async () => {
      try {
        const messages = await api.branchContext(branch);
        if (!alive) return;
        setEntries(
          messages.map((message) => ({
            kind: "message" as const,
            role: message.role,
            content: message.content,
          })),
        );
      } catch {
        if (alive) setEntries([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [branch]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [draft]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [entries, thinking, streamed]);

  const patchControls = (patch: Partial<ComposerControls>) =>
    setControls((current) => ({ ...current, ...patch }));

  const pushUser = (text: string) =>
    setEntries((current) => [...current, { kind: "message", role: "user", content: text }]);

  // Seed sensible council and image defaults once the registry loads.
  useEffect(() => {
    setControls((current) =>
      current.council.length >= 2 || councilCandidates.length === 0
        ? current
        : {
            ...current,
            council: councilCandidates
              .slice(0, Math.min(3, councilCandidates.length))
              .map((candidate) => candidate.key),
          },
    );
  }, [councilCandidates]);

  useEffect(() => {
    // Prefer a connected cloud image provider; the offline mock beats a dead local SD.
    const fallback =
      imageProviders.find((entry) => isReady(entry) && entry.kind !== "local") ??
      imageProviders.find((entry) => isReady(entry)) ??
      imageProviders.find((entry) => entry.kind === "mock") ??
      imageProviders[0];
    if (!fallback) return;
    setControls((current) =>
      current.imageProvider
        ? current
        : {
            ...current,
            imageProvider: fallback.id,
            imageModel: fallback.models[0] ?? fallback.default_model ?? "",
          },
    );
  }, [imageProviders]);

  const openBlame = async (index: number) => {
    const entry = entries[index];
    if (!entry || entry.kind !== "message") return;
    if (blameCache.current === null) {
      try {
        blameCache.current = await api.branchBlame(branch);
      } catch {
        blameCache.current = [];
      }
    }
    const match =
      blameCache.current.find(
        (item) => item.role === entry.role && item.content === entry.content,
      ) ?? null;
    setBlame({
      claim: entry.content,
      commitId: match?.commit_id ?? "",
      kind: match?.kind ?? "",
      model: match?.model ?? "",
      author: match?.author ?? null,
      summary: match?.summary ?? null,
      createdAt: match?.created_at ?? "",
      role: entry.role,
      branch,
      sample: match === null,
    });
  };

  // ---- Chat: one model, streamed from the backend and committed as context --------------
  const runChat = async (text: string) => {
    pushUser(text);
    setThinking(true);
    setStreamed("");
    setRunning(true);
    accumulated.current = "";
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const { answer } = await streamChat(
        {
          prompt: text,
          branch,
          commitId,
          model: selection.modelId,
          provider: selection.providerId,
        },
        (chunk) => {
          accumulated.current += chunk;
          setStreamed(accumulated.current);
        },
        controller.signal,
      );
      setEntries((current) => [
        ...current,
        { kind: "message", role: "assistant", content: answer },
      ]);
      onCommitted?.();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Chat failed";
      setEntries((current) => [
        ...current,
        { kind: "message", role: "assistant", content: `⚠ ${detail}` },
      ]);
    } finally {
      accumulated.current = "";
      setStreamed("");
      setThinking(false);
      setRunning(false);
      abortRef.current = null;
    }
  };

  // ---- Council: same prompt to several providers, streamed in parallel -----------------
  const runCouncil = async (text: string) => {
    const members: CouncilMemberView[] = councilMembers(controls.council)
      .map((key) => councilCandidates.find((candidate) => candidate.key === key))
      .filter((candidate): candidate is CouncilCandidate => candidate !== undefined)
      .map((candidate) => ({
        key: candidate.key,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        label: candidate.label,
      }));
    if (members.length < 2) return;
    pushUser(text);
    setRunning(true);
    const councilIndex = entries.length + 1;
    setEntries((current) => [
      ...current,
      {
        kind: "council",
        prompt: text,
        members,
        answers: members.map(() => ""),
        errors: members.map(() => null),
        kept: null,
      },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamCouncil(
        {
          prompt: text,
          branch,
          commitId,
          members: members.map((member) => ({
            provider: member.providerId,
            model: member.modelId,
          })),
        },
        (event: CouncilEvent) => {
          if (event.type === "done") return;
          const index = typeof event.index === "number" ? event.index : null;
          if (index === null) return;
          setEntries((current) =>
            current.map((entry, position) => {
              if (position !== councilIndex || entry.kind !== "council") return entry;
              if (event.type === "token") {
                const answers = [...entry.answers];
                answers[index] = `${answers[index] ?? ""}${event.text}`;
                return { ...entry, answers };
              }
              if (event.type === "member_done") {
                const answers = [...entry.answers];
                answers[index] = event.answer;
                return { ...entry, answers };
              }
              if (event.type === "error") {
                const errors = [...entry.errors];
                errors[index] = event.error;
                return { ...entry, errors };
              }
              return entry;
            }),
          );
        },
        controller.signal,
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Council failed";
      setEntries((current) => [
        ...current,
        { kind: "message", role: "assistant", content: `⚠ ${detail}` },
      ]);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const keepCouncil = async (entryIndex: number, memberIndex: number) => {
    const entry = entries[entryIndex];
    if (!entry || entry.kind !== "council") return;
    const member = entry.members[memberIndex];
    const answer = entry.answers[memberIndex];
    if (!member || !answer) return;
    setEntries((current) =>
      current.map((item, position) =>
        position === entryIndex && item.kind === "council"
          ? { ...item, kept: memberIndex }
          : item,
      ),
    );
    try {
      await api.commit({
        messages: [
          { role: "user", content: entry.prompt },
          { role: "assistant", content: answer },
        ],
        model: member.modelId,
        summary: `council: kept ${member.label}`,
        branch,
      });
      onCommitted?.();
    } catch (cause) {
      const detail =
        cause instanceof Error ? cause.message : "Could not record the council decision";
      setEntries((current) => [
        ...current,
        { kind: "message", role: "assistant", content: `⚠ ${detail}` },
      ]);
    }
  };

  // ---- Research: a real loop, streamed as visible steps, then a cited artifact ----------
  const runResearch = async (text: string) => {
    pushUser(text);
    setRunning(true);
    const researchIndex = entries.length + 1;
    setEntries((current) => [
      ...current,
      {
        kind: "research",
        mode: controls.researchMode,
        steps: [],
        sources: [],
        report: "",
        result: null,
        error: null,
        done: false,
      },
    ]);
    const budget = RESEARCH_BUDGETS[controls.depth];
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamResearch(
        {
          mode: controls.researchMode,
          prompt: text,
          provider: selection.providerId || undefined,
          model: selection.modelId || undefined,
          searchProvider: defaultSearch?.id,
          branch,
          commitId,
          breadth: budget.breadth,
          depth: budget.depth,
          maxPages: budget.maxPages,
        },
        (event: ResearchEvent) => {
          setEntries((current) =>
            current.map((entry, position) => {
              if (position !== researchIndex || entry.kind !== "research") return entry;
              if (event.type === "step") {
                const next = {
                  id: event.id,
                  label: event.label,
                  detail: event.detail,
                  status: event.status,
                };
                const at = entry.steps.findIndex((step) => step.id === event.id);
                const steps =
                  at >= 0
                    ? entry.steps.map((step, index) => (index === at ? next : step))
                    : [...entry.steps, next];
                return { ...entry, steps };
              }
              if (event.type === "source") {
                return {
                  ...entry,
                  sources: [
                    ...entry.sources,
                    { id: event.id, title: event.title, host: event.host },
                  ],
                };
              }
              if (event.type === "report") {
                return { ...entry, report: entry.report + event.text };
              }
              if (event.type === "result") {
                return { ...entry, result: event as unknown as ResearchResultPayload };
              }
              if (event.type === "error") {
                return { ...entry, error: event.error };
              }
              return entry;
            }),
          );
        },
        controller.signal,
      );
      setEntries((current) =>
        current.map((entry, position) =>
          position === researchIndex && entry.kind === "research"
            ? { ...entry, done: true }
            : entry,
        ),
      );
      onCommitted?.();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Research failed";
      setEntries((current) => [
        ...current,
        { kind: "message", role: "assistant", content: `⚠ ${detail}` },
      ]);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  // ---- Image: the prompt is the versioned artifact; tiles are real renders --------------
  const runImage = async (text: string) => {
    const providerId = controls.imageProvider || imageProviders[0]?.id || "mock-image";
    const activeProvider =
      imageProviders.find((entry) => entry.id === providerId) ?? imageProviders[0];
    const modelId =
      controls.imageModel || activeProvider?.models[0] || activeProvider?.default_model || "";
    const last = entries[entries.length - 1];
    const reuse = last?.kind === "image" && last.model === modelId;
    const imageIndex = reuse ? entries.length - 1 : entries.length;
    setRunning(true);
    setEntries((current) => {
      if (reuse && last?.kind === "image") {
        return [
          ...current.slice(0, -1),
          {
            ...last,
            versions: [
              ...last.versions,
              { version: last.versions.length + 1, text, note: "edited prompt" },
            ],
            tiles: [],
            aspect: controls.aspect,
          },
        ];
      }
      return [
        ...current,
        {
          kind: "image",
          versions: [{ version: 1, text, note: "initial prompt" }],
          tiles: [],
          model: modelId,
          aspect: controls.aspect,
        },
      ];
    });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamImages(
        {
          prompt: text,
          provider: providerId,
          model: modelId,
          aspect: controls.aspect,
          count: 4,
          branch,
          commitId,
        },
        (event: ImageEvent) => {
          if (event.type !== "image") return;
          setEntries((current) =>
            current.map((entry, position) =>
              position === imageIndex && entry.kind === "image"
                ? {
                    ...entry,
                    tiles: [
                      ...entry.tiles,
                      { seed: event.seed, model: event.model, src: event.data_url ?? event.url },
                    ],
                  }
                : entry,
            ),
          );
        },
        controller.signal,
      );
      onCommitted?.();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Image generation failed";
      setEntries((current) => [
        ...current,
        { kind: "message", role: "assistant", content: `⚠ ${detail}` },
      ]);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  // The prompt shown when a mode has no usable provider (mock/bare rows excluded).
  const gate: { capability: ProviderCapability; title: string; message: string } | null = (() => {
    if (mode === "chat" && readyChatCount === 0) {
      return {
        capability: "chat",
        title: "Connect a model to chat",
        message:
          "Add an API key for a model provider (Agnes AI, OpenRouter, Groq, Anthropic, OpenAI…) to start. ContextGit talks straight to your provider and keeps the key on this machine.",
      };
    }
    if (mode === "council" && readyCouncilModels < 2) {
      return {
        capability: "chat",
        title: "Connect two models for a council",
        message:
          "A council asks the same prompt of several models. Connect a provider with at least two models — several models from one provider work fine — or add a second provider with a key.",
      };
    }
    if (mode === "image" && readyImageCount === 0) {
      return {
        capability: "image",
        title: "Connect an image provider",
        message:
          "Add an OpenAI Images key, or enable a local Stable Diffusion server, to render prompts.",
      };
    }
    if (mode === "research" && (readyChatCount === 0 || readySearchCount === 0)) {
      return readyChatCount === 0
        ? {
            capability: "chat",
            title: "Connect a model and a search key",
            message:
              "Research needs a model to plan and write, and a search backend (Tavily) to find sources.",
          }
        : {
            capability: "search",
            title: "Connect a search backend",
            message:
              "Research needs a search key (Tavily) to find and cite real sources. Add it to run research.",
          };
    }
    return null;
  })();
  const blocked = !offlineOk && gate !== null;

  const canSend =
    draft.trim().length > 0 &&
    !running &&
    !blocked &&
    (mode !== "council" || councilMembers(controls.council).length >= 2) &&
    (mode !== "chat" || (Boolean(provider) && selection.modelId !== ""));

  const send = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    setDraft("");
    if (mode === "chat") void runChat(text);
    else if (mode === "council") void runCouncil(text);
    else if (mode === "research") void runResearch(text);
    else void runImage(text);
  };

  const placeholder =
    mode === "image"
      ? IMAGE_PLACEHOLDER
      : mode === "council"
        ? `Ask the same question of ${councilMembers(controls.council).length} models…`
        : mode === "research"
          ? "What should it research?"
          : `Ask ${modelLabel || "the model"}…`;

  const label =
    mode === "chat"
      ? `New message on ${branch || "this branch"}`
      : mode === "council"
        ? "Council run"
        : mode === "research"
          ? "Research run"
          : "Image prompt";

  const footNote =
    mode === "chat"
      ? `Replying with ${provider?.label ?? "—"} · ${modelLabel || "choose a model"}`
      : mode === "council"
        ? `${councilMembers(controls.council).length} models · one decision recorded`
        : mode === "research"
          ? `${controls.researchMode} · ${controls.depth} depth · every step commits`
          : `${controls.imageModel || "choose an image model"} · ${controls.aspect}`;

  return (
    <div className="cg-chat">
      <div className="cg-view-toolbar">
        <h1>{branch || "Conversation"}</h1>
        {commitId && <Chip>{commitId.slice(0, 7)}</Chip>}
        <Chip tone="ok">live</Chip>
        <span className="cg-toolbar-spacer" />
        <button
          type="button"
          className="cg-model-btn"
          onClick={onPickModel}
          aria-haspopup="dialog"
          title="Change provider and model"
        >
          <AgentMark agent={brand.hue} icon={brand.icon} label={brand.monogram} />
          <span className="cg-model-btn-copy">
            <span className="cg-model-btn-model">
              {modelLabel || "Choose a model"}
            </span>
            <span className="cg-model-btn-provider">{provider?.label ?? "Add a provider"}</span>
          </span>
          <span className="cg-model-btn-caret" aria-hidden="true">
            ⌄
          </span>
        </button>
        <button
          type="button"
          className="cg-chip cg-chip-btn"
          onClick={() => onAddProvider("chat")}
        >
          Add provider
        </button>
      </div>

      <div className="cg-chat-log" ref={logRef} aria-live="polite">
        {blocked && gate && (
          <ConnectProviderCard
            capability={gate.capability}
            title={gate.title}
            message={gate.message}
            providers={providers}
            onAddProvider={onAddProvider}
            onUseOffline={onUseOffline}
          />
        )}
        {entries.map((entry, index) => {
          if (entry.kind === "message") {
            return (
              <article key={index} className="cg-msg" data-role={entry.role}>
                <span className="cg-msg-role">{entry.role}</span>
                <p>{entry.content}</p>
                <button
                  type="button"
                  className="cg-blame-btn"
                  onClick={() => void openBlame(index)}
                  title="Where did this come from?"
                >
                  <LuCornerUpLeft aria-hidden="true" /> blame
                </button>
              </article>
            );
          }
          if (entry.kind === "council") {
            return (
              <CouncilCard
                key={index}
                members={entry.members}
                answers={entry.answers}
                errors={entry.errors}
                kept={entry.kept}
                onKeep={(memberIndex) => void keepCouncil(index, memberIndex)}
              />
            );
          }
          if (entry.kind === "research") {
            return (
              <ResearchRun
                key={index}
                mode={entry.mode}
                steps={entry.steps}
                sources={entry.sources}
                report={entry.report}
                result={entry.result}
                error={entry.error}
                done={entry.done}
              />
            );
          }
          return (
            <ImageLab
              key={index}
              versions={entry.versions}
              tiles={entry.tiles}
              model={entry.model}
              aspect={entry.aspect}
            />
          );
        })}

        {thinking && (
          <div className="cg-msg cg-msg-working" data-role="assistant" role="status">
            <span className="cg-msg-role">assistant</span>
            <span className="cg-thinking">
              <span className="cg-thinking-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Thinking… ({modelLabel || "model"})
            </span>
          </div>
        )}

        {streamed && (
          <div className="cg-msg" data-role="assistant">
            <span className="cg-msg-role">assistant · streaming</span>
            <p>
              {streamed}
              <span className="cg-caret" aria-hidden="true" />
            </p>
          </div>
        )}
      </div>

      <form
        className="cg-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="cg-composer-inner">
          <ComposerModes
            mode={mode}
            onMode={setMode}
            controls={controls}
            onControls={patchControls}
            councilCandidates={councilCandidates}
            imageProviders={imageProviders}
          />
          <label className="cg-kicker" htmlFor="cg-chat-prompt">
            {label}
          </label>
          <div className="cg-input">
            <textarea
              id="cg-chat-prompt"
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={placeholder}
            />
            <button
              type="submit"
              className="cg-send"
              aria-label={mode === "image" ? "Generate image" : "Send message"}
              title={mode === "image" ? "Generate" : "Send (Enter)"}
              disabled={!canSend}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path
                  d="M8 13.5V3M8 3L3.5 7.5M8 3l4.5 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div className="cg-composer-row">
            <span className="cg-composer-model">{footNote}</span>
            <span className="cg-toolbar-spacer" />
            <span className="cg-composer-model">Enter to send · Shift+Enter for a new line</span>
          </div>
        </div>
      </form>

      {blame && <BlameSheet view={blame} onClose={() => setBlame(null)} />}
    </div>
  );
}
