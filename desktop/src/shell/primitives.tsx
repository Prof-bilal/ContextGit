import type { ReactNode } from "react";

import type { SessionStatus } from "@/lib/api";

export function StatusDot({ status }: { status: SessionStatus }) {
  return (
    <span
      className="cg-dot"
      data-status={status}
      role="img"
      aria-label={`Status: ${status}`}
    />
  );
}

export function Monogram({
  agent,
  label,
  size,
}: {
  agent: string;
  label: string;
  size?: "lg";
}) {
  return (
    <span className="cg-mono-badge" data-agent={agent} data-size={size} aria-hidden="true">
      {label}
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
