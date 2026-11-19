/** Shared primitives for the web app. Styles live in tokens.css (`ui-*`). */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { SessionStatus } from "@/shared/api";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
};

export function Button({ variant = "default", size = "md", icon, className, children, type = "button", ...rest }: ButtonProps) {
  const classes = ["ui-btn", variant !== "default" && `ui-btn--${variant}`, size !== "md" && `ui-btn--${size}`, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/** Icon-only button. `label` is both the accessible name and the hover tooltip. */
export function IconButton({ label, icon, active, current, className, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: ReactNode;
  active?: boolean;
  current?: boolean;
}) {
  return (
    <button
      type={type}
      className={["ui-icon-btn", className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      aria-current={current ? "page" : undefined}
      {...rest}
    >
      {icon}
      <span className="ui-tip" aria-hidden="true">{label}</span>
    </button>
  );
}

export function Chip({ children, icon, pressed, onClick, title }: {
  children: ReactNode;
  icon?: ReactNode;
  pressed?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  if (!onClick) {
    return <span className="ui-chip ui-chip--static" title={title}>{icon}<span>{children}</span></span>;
  }
  return (
    <button type="button" className="ui-chip" aria-pressed={pressed} onClick={onClick} title={title}>
      {icon}<span>{children}</span>
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["ui-card", className].filter(Boolean).join(" ")}>{children}</div>;
}

export interface TabItem<T extends string> { id: T; label: string; icon?: ReactNode }

export function Tabs<T extends string>({ items, value, onChange, label }: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={item.id === value}
          onClick={() => onChange(item.id)}
        >
          {item.icon}{item.label}
        </button>
      ))}
    </div>
  );
}

export function StatusDot({ status, label }: { status: SessionStatus; label?: string }) {
  return <span className={`ui-dot ui-dot--${status}`} role="img" aria-label={label ?? status} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="ui-page-header">
      <h1>{title}</h1>
      <span className="ui-spacer" />
      {children}
    </header>
  );
}
