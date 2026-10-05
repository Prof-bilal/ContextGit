import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import { BsOpenai, BsRobot } from "react-icons/bs";
import {
  LuCircle,
  LuCircleAlert,
  LuCircleCheck,
  LuLoaderCircle,
  LuPlug,
  LuSparkles,
} from "react-icons/lu";
import {
  SiAnthropic,
  SiClaude,
  SiCline,
  SiGnubash,
  SiGooglegemini,
  SiOllama,
  SiOpencode,
} from "react-icons/si";

import type { SessionStatus } from "@/lib/api";
import { CommandCodeMark, FreebuffMark, KiloMark, PiMark } from "./marks/brand";

/** Real brand mark per agent / provider key; unknown keys fall back to a letter. */
const MARKS: Record<string, IconType> = {
  claude: SiClaude,
  anthropic: SiAnthropic,
  chatgpt: BsOpenai,
  openai: BsOpenai,
  codex: BsOpenai,
  gemini: SiGooglegemini,
  google: SiGooglegemini,
  opencode: SiOpencode,
  ollama: SiOllama,
  local: SiOllama,
  shell: SiGnubash,
  aider: BsRobot,
  grok: LuSparkles,
  compatible: LuPlug,
  freebuff: FreebuffMark,
  cline: SiCline,
  pi: PiMark,
  kilo: KiloMark,
  commandcode: CommandCodeMark,
};

const STATUS_ICONS: Record<SessionStatus, IconType> = {
  idle: LuCircle,
  running: LuLoaderCircle,
  done: LuCircleCheck,
  error: LuCircleAlert,
};

export function StatusIcon({ status }: { status: SessionStatus }) {
  const Icon = STATUS_ICONS[status];
  return (
    <Icon className="cg-status" data-status={status} role="img" aria-label={`Status: ${status}`} />
  );
}

/** Official brand colour per agent / provider key (theme-aware for monochrome marks). */
const MARK_COLORS: Record<string, string> = {
  claude: "var(--cg-brand-claude)",
  anthropic: "var(--cg-brand-claude)",
  chatgpt: "var(--cg-brand-openai)",
  openai: "var(--cg-brand-openai)",
  codex: "var(--cg-brand-openai)",
  gemini: "var(--cg-brand-gemini)",
  google: "var(--cg-brand-gemini)",
  opencode: "var(--cg-brand-opencode)",
  ollama: "var(--cg-brand-ollama)",
  local: "var(--cg-brand-ollama)",
  shell: "var(--cg-brand-shell)",
  aider: "var(--cg-brand-aider)",
  grok: "var(--cg-brand-openai)",
  compatible: "var(--cg-ink-2)",
  freebuff: "var(--cg-brand-freebuff)",
  cline: "var(--cg-brand-cline)",
  pi: "var(--cg-brand-pi)",
  kilo: "var(--cg-brand-kilo)",
  commandcode: "var(--cg-brand-commandcode)",
};

export function AgentMark({
  agent,
  icon,
  label,
  size,
}: {
  /** Fallback key when no explicit `icon` is given. */
  agent: string;
  /** Brand key; agents and providers differ here. Defaults to `agent`. */
  icon?: string;
  label: string;
  size?: "lg";
}) {
  const key = icon ?? agent;
  const Mark = MARKS[key];
  const color = MARK_COLORS[key] ?? "var(--cg-ink-2)";
  return (
    <span className="cg-mark" data-size={size} aria-hidden="true" style={{ color }}>
      {Mark ? <Mark /> : label}
    </span>
  );
}

export function Chip({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: "signal" | "ok" | "bad" | "warn";
}) {
  return (
    <span className="cg-chip" data-tone={tone}>
      {children}
    </span>
  );
}

export function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="cg-icon-btn"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MiniSeg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="cg-mini-seg" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="cg-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </dl>
  );
}
