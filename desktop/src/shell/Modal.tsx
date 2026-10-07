import { useEffect, useRef, type ReactNode } from "react";
import { LuX } from "react-icons/lu";

/** Topmost-modal tracking so Escape closes only the front dialog. */
const modalStack: symbol[] = [];

/**
 * Shared dialog shell: backdrop click closes, Esc closes, Tab is trapped, focus
 * returns to the trigger on close. Used by the read-only run sheets.
 */
export default function Modal({
  title,
  subtitle,
  onClose,
  footer,
  size = "md",
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  size?: "md" | "lg";
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  // Escape closes the front-most dialog even when focus sits outside it (e.g.
  // after a button that removed itself).
  useEffect(() => {
    const id = Symbol("modal");
    modalStack.push(id);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (modalStack[modalStack.length - 1] !== id) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = modalStack.indexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
    };
  }, [onClose]);

  return (
    <div className="cg-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className={`cg-modal${size === "lg" ? " cg-modal-lg" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            );
            if (!focusables || focusables.length === 0) return;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <header className="cg-picker-head">
          <h2>{title}</h2>
          {subtitle && <span className="cg-view-sub">{subtitle}</span>}
          <span className="cg-toolbar-spacer" />
          <button type="button" className="cg-icon-btn" aria-label="Close" onClick={onClose}>
            <LuX aria-hidden="true" />
          </button>
        </header>

        <div className="cg-modal-body">{children}</div>

        {footer && <footer className="cg-mission-foot">{footer}</footer>}
      </div>
    </div>
  );
}
