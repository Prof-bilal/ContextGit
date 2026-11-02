/** OWNER: library agent. Layout pieces shared by the Skills, Memory and Settings pages. */
import type { ReactNode } from "react";
import { LuFolderOpen } from "react-icons/lu";
import { useApp } from "../context";
import { Button, EmptyState, PageHeader } from "../ui";
import "./library.css";

export function errorText(cause: unknown, fallback = "Something went wrong."): string {
  if (cause instanceof Error) return cause.message || fallback;
  if (typeof cause === "string") return cause || fallback;
  return fallback;
}

/** Full-height page: header + scrollable body. */
export function LibraryPage({ title, actions, children, scroll = true }: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** When false the body is a plain flex column (the page manages its own scrolling). */
  scroll?: boolean;
}) {
  return (
    <section className="lib-page" aria-label={typeof title === "string" ? title : undefined}>
      <PageHeader title={title}>{actions}</PageHeader>
      <div className={scroll ? "lib-body app-scroll" : "lib-body lib-body--fixed"}>{children}</div>
    </section>
  );
}

/** Centred column (~880px) used by single-column pages. */
export function LibraryContent({ children }: { children: ReactNode }) {
  return <div className="lib-content">{children}</div>;
}

/** A settings-style card: title + description on top, content below. */
export function Section({ title, description, actions, children, id }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className="ui-card lib-section" aria-labelledby={headingId}>
      <header className="lib-section-head">
        <div>
          <h2 id={headingId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="lib-section-actions">{actions}</div>}
      </header>
      {children !== undefined && <div className="lib-section-body">{children}</div>}
    </section>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "accent"; children: ReactNode }) {
  return <span className={`lib-badge lib-badge--${tone}`}>{children}</span>;
}

/** Shown in place of a page body when no project is open. */
export function NoProject({ title, what }: { title: string; what: string }) {
  const { go } = useApp();
  return (
    <LibraryPage title={title}>
      <EmptyState
        title="Open a project first"
        action={<Button variant="primary" icon={<LuFolderOpen />} onClick={() => go({ kind: "home" })}>Open a project</Button>}
      >
        {what}
      </EmptyState>
    </LibraryPage>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
