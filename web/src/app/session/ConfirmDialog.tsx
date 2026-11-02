/** A small modal confirm step for destructive session actions. Esc or the backdrop cancels. */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "../ui";

export interface ConfirmAction {
  label: string;
  variant?: "primary" | "danger" | "default";
  onSelect: () => void;
}

export default function ConfirmDialog({ title, children, actions, busy, error, onCancel }: {
  title: string;
  children?: ReactNode;
  actions: ConfirmAction[];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.stopPropagation(); cancel.current(); }
      if (event.key === "Tab" && dialogRef.current) {
        // Keep focus inside the dialog.
        const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); previous?.focus?.(); };
  }, []);

  return (
    <div className="session-confirm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <div ref={dialogRef} className="session-confirm ui-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {children && <div className="session-confirm-body">{children}</div>}
        {error && <div className="ui-error" role="alert">{error}</div>}
        <div className="session-confirm-actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
          {actions.map(action => (
            <Button key={action.label} variant={action.variant === "default" ? undefined : action.variant} onClick={action.onSelect} disabled={busy}>
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
