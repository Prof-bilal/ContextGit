import { useEffect, useRef } from "react";

import type { BlameRecord } from "../../mock/chat";
import { Field } from "../primitives";

/**
 * Provenance for one claim: which turn, session, branch and agent introduced it,
 * and what it replaced. Same modal mechanics as the model picker (focus trap,
 * Esc, backdrop click, focus restored on close).
 */
export default function BlameSheet({
  record,
  onClose,
}: {
  record: BlameRecord;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  return (
    <div className="cg-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="cg-modal cg-blame"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cg-blame-title"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
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
          <h2 id="cg-blame-title">Where this came from</h2>
          <span className="cg-toolbar-spacer" />
          <button type="button" className="cg-icon-btn" aria-label="Close blame" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="cg-blame-body">
          <blockquote className="cg-blame-claim">{record.claim}</blockquote>
          <div className="cg-fields">
            <Field label="Turn">#{record.turn} of this chat</Field>
            <Field label="Session">{record.session}</Field>
            <Field label="Agent">{record.agent}</Field>
            <Field label="Branch">{record.branch}</Field>
            <Field label="Commit">
              <span className="cg-mono">{record.commitId.slice(0, 7)}</span>
            </Field>
            <Field label="Replaced">
              {record.replaced ?? <span className="cg-empty-note">nothing — this introduced it</span>}
            </Field>
          </div>
          <div className="cg-dock-actions">
            <button type="button" className="cg-btn">
              View diff
            </button>
            <button type="button" className="cg-btn" data-variant="primary">
              Jump to commit
            </button>
          </div>
          <p className="cg-empty-note">
            Cross-session provenance: this claim was introduced in another run and inherited here.
          </p>
        </div>
      </div>
    </div>
  );
}
