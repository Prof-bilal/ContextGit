import { useEffect, useRef, useState } from "react";
import { LuCornerUpLeft } from "react-icons/lu";

import {
  COUNCIL_ANSWERS,
  DEFAULT_CONTROLS,
  PROMPT_VERSIONS,
  RESEARCH_REPORT,
  RESEARCH_SOURCES,
  RESEARCH_STEPS,
  blameFor,
  type ChatMode,
  type ComposerControls,
  type CouncilAnswer,
} from "../../mock/chat";
import type { Conversation } from "../../mock/fixtures";
import { findModel, findProvider, type ModelSelection } from "../providers";
import { AgentMark, Chip } from "../primitives";
import BlameSheet from "../chat/BlameSheet";
import ComposerModes from "../chat/ComposerModes";
import CouncilCard from "../chat/CouncilCard";
import ImageLab, { type ImageTile } from "../chat/ImageLab";
import ResearchRun, { type ResearchSource, type StepState } from "../chat/ResearchRun";

type Entry =
  | { kind: "message"; role: "user" | "assistant"; content: string }
  | { kind: "council"; providers: string[]; answers: CouncilAnswer[]; kept: string | null }
  | { kind: "research"; steps: StepState[]; sources: ResearchSource[]; report: string; done: boolean }
  | {
      kind: "image";
      versions: Array<{ version: number; text: string; note: string }>;
      tiles: ImageTile[];
      model: string;
      aspect: string;
    };

const MOCK_REPLY =
  "Short answer: in-process with an LRU while you run a single node — Redis only earns its " +
  "place once there are several instances to coordinate. One node means one clock, so the " +
  "bucket refill window can't disagree with itself the way it did in that 50ms skew incident.";

const IMAGE_PLACEHOLDER = PROMPT_VERSIONS[1].text;

export default function ChatView({
  conversation,
  selection,
  onPickModel,
}: {
  conversation: Conversation;
  selection: ModelSelection;
  onPickModel: () => void;
}) {
  const provider = findProvider(selection.providerId);
  const model = findModel(selection);

  const [entries, setEntries] = useState<Entry[]>(() =>
    conversation.messages.map((message) => ({
      kind: "message" as const,
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content,
    })),
  );
  const [mode, setMode] = useState<ChatMode>("chat");
  const [controls, setControls] = useState<ComposerControls>(DEFAULT_CONTROLS);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [streamed, setStreamed] = useState("");
  const [blameIndex, setBlameIndex] = useState<number | null>(null);

  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const timers = useRef<number[]>([]);
  const accumulated = useRef("");
  const seedRef = useRef(1000);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

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

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const patchControls = (patch: Partial<ComposerControls>) =>
    setControls((current) => ({ ...current, ...patch }));

  const pushUser = (text: string) =>
    setEntries((current) => [...current, { kind: "message", role: "user", content: text }]);

  // ---- Chat: one model, streaming reply -------------------------------------------------
  const runChat = (text: string) => {
    pushUser(text);
    setThinking(true);
    setStreamed("");
    accumulated.current = "";
    const words = MOCK_REPLY.split(" ");
    later(() => {
      setThinking(false);
      words.forEach((word, index) => {
        later(() => {
          accumulated.current = accumulated.current ? `${accumulated.current} ${word}` : word;
          setStreamed(accumulated.current);
          if (index === words.length - 1) {
            later(() => {
              const final = accumulated.current;
              accumulated.current = "";
              setStreamed("");
              setEntries((current) => [...current, { kind: "message", role: "assistant", content: final }]);
            }, 250);
          }
        }, index * 42);
      });
    }, 950);
  };

  // ---- Council: same prompt, several models --------------------------------------------
  const runCouncil = (text: string) => {
    const providers = controls.council;
    pushUser(text);
    setRunning(true);
    setEntries((current) => [...current, { kind: "council", providers, answers: [], kept: null }]);
    const councilIndex = entries.length + 1;

    providers.forEach((providerId, order) => {
      later(() => {
        const canned = COUNCIL_ANSWERS.find((answer) => answer.providerId === providerId);
        setEntries((current) =>
          current.map((entry, position) =>
            position === councilIndex && entry.kind === "council"
              ? {
                  ...entry,
                  answers: [
                    ...entry.answers,
                    canned ?? {
                      providerId,
                      modelId: "default",
                      stance: "answer",
                      text: "In-process while you run one node; put the bucket behind an interface so a later swap to Redis stays a one-file change.",
                    },
                  ],
                }
              : entry,
          ),
        );
        if (order === providers.length - 1) setRunning(false);
      }, 600 + order * 500);
    });
  };

  const keepCouncil = (entryIndex: number, providerId: string) => {
    setEntries((current) =>
      current.map((entry, position) =>
        position === entryIndex && entry.kind === "council" ? { ...entry, kept: providerId } : entry,
      ),
    );
  };

  // ---- Research: visible steps, then a cited report -------------------------------------
  const runResearch = (text: string) => {
    pushUser(text);
    setRunning(true);
    const researchIndex = entries.length + 1;
    setEntries((current) => [
      ...current,
      {
        kind: "research",
        steps: RESEARCH_STEPS.map((step) => ({ ...step, status: "pending" as const })),
        sources: [],
        report: "",
        done: false,
      },
    ]);

    RESEARCH_STEPS.forEach((step, order) => {
      later(() => {
        setEntries((current) =>
          current.map((entry, position) =>
            position === researchIndex && entry.kind === "research"
              ? {
                  ...entry,
                  steps: entry.steps.map((item, stepIndex) =>
                    stepIndex === order
                      ? { ...item, status: "active" as const }
                      : { ...item, status: stepIndex < order ? ("done" as const) : item.status },
                  ),
                  sources: RESEARCH_SOURCES.slice(0, Math.min(RESEARCH_SOURCES.length, (order + 1) * 2)),
                }
              : entry,
          ),
        );
      }, 500 + order * 800);
    });

    later(() => {
      setEntries((current) =>
        current.map((entry, position) =>
          position === researchIndex && entry.kind === "research"
            ? {
                ...entry,
                steps: entry.steps.map((item) => ({ ...item, status: "done" as const })),
                sources: RESEARCH_SOURCES,
                report: RESEARCH_REPORT,
                done: true,
              }
            : entry,
        ),
      );
      setRunning(false);
    }, 500 + RESEARCH_STEPS.length * 800);
  };

  // ---- Image: the prompt is the versioned artifact --------------------------------------
  const runImage = (text: string) => {
    seedRef.current += 17;
    const tiles: ImageTile[] = Array.from({ length: 4 }, (_, index) => ({
      seed: seedRef.current + index,
      model: controls.imageModel,
    }));
    setEntries((current) => {
      const last = current[current.length - 1];
      if (last?.kind === "image" && last.model === controls.imageModel) {
        const nextVersion = last.versions.length + 1;
        return [
          ...current.slice(0, -1),
          {
            ...last,
            versions: [...last.versions, { version: nextVersion, text, note: "edited prompt" }],
            tiles,
            aspect: controls.aspect,
          },
        ];
      }
      return [
        ...current,
        {
          kind: "image",
          versions: [{ version: 1, text, note: "initial prompt" }],
          tiles,
          model: controls.imageModel,
          aspect: controls.aspect,
        },
      ];
    });
  };

  const canSend =
    draft.trim().length > 0 &&
    !running &&
    (mode !== "council" || controls.council.length >= 2);

  const send = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    setDraft("");
    if (mode === "chat") runChat(text);
    else if (mode === "council") runCouncil(text);
    else if (mode === "research") runResearch(text);
    else runImage(text);
  };

  const placeholder =
    mode === "image"
      ? IMAGE_PLACEHOLDER
      : mode === "council"
        ? `Ask the same question of ${controls.council.length} models…`
        : mode === "research"
          ? "What should it research?"
          : `Ask ${model?.label ?? "the model"}…`;

  const label =
    mode === "chat"
      ? `New message on ${conversation.branch.name}`
      : mode === "council"
        ? "Council run"
        : mode === "research"
          ? "Research run"
          : "Image prompt";

  const footNote =
    mode === "chat"
      ? `Replying with ${provider?.label ?? "—"} · ${model?.label ?? "choose a model"}`
      : mode === "council"
        ? `${controls.council.length} models · one decision recorded`
        : mode === "research"
          ? `${controls.depth} depth · every step commits`
          : "no image endpoint is wired in the mock";

  return (
    <div className="cg-chat">
      <div className="cg-view-toolbar">
        <h1>{conversation.branch.name}</h1>
        <Chip>{conversation.branch.head_commit_id.slice(0, 7)}</Chip>
        <Chip tone="warn">sample data</Chip>
        <span className="cg-toolbar-spacer" />
        <button
          type="button"
          className="cg-model-btn"
          onClick={onPickModel}
          aria-haspopup="dialog"
          title="Change provider and model"
        >
          {provider && <AgentMark agent={provider.hue} icon={provider.id} label={provider.monogram} />}
          <span className="cg-model-btn-copy">
            <span className="cg-model-btn-model">{model?.label ?? "Choose a model"}</span>
            <span className="cg-model-btn-provider">{provider?.label ?? "—"}</span>
          </span>
          <span className="cg-model-btn-caret" aria-hidden="true">
            ⌄
          </span>
        </button>
      </div>

      <div className="cg-chat-log" ref={logRef} aria-live="polite">
        {entries.map((entry, index) => {
          if (entry.kind === "message") {
            return (
              <article key={index} className="cg-msg" data-role={entry.role}>
                <span className="cg-msg-role">{entry.role}</span>
                <p>{entry.content}</p>
                <button
                  type="button"
                  className="cg-blame-btn"
                  onClick={() => setBlameIndex(index)}
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
                providers={entry.providers}
                answers={entry.answers}
                kept={entry.kept}
                onKeep={(providerId) => keepCouncil(index, providerId)}
              />
            );
          }
          if (entry.kind === "research") {
            return (
              <ResearchRun
                key={index}
                steps={entry.steps}
                sources={entry.sources}
                report={entry.report}
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
              Thinking… ({model?.label ?? "model"})
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

      {blameIndex !== null && entries[blameIndex]?.kind === "message" && (
        <BlameSheet
          record={blameFor(blameIndex, (entries[blameIndex] as { content: string }).content)}
          onClose={() => setBlameIndex(null)}
        />
      )}
    </div>
  );
}
