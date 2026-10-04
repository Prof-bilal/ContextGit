import { useEffect, useRef } from "react";
import { LuX } from "react-icons/lu";

import { Field } from "../primitives";

/** Provenance for one message. `sample` means it is not part of this branch. */
export interface BlameView {
  claim: string;
  commitId: string;
  kind: string;
  model: string;
  author: string | null;
  summary: string | null;
  createdAt: string;
  role: string;
  branch: string;
  sample: boolean;
}

/**
 * Provenance for one claim: the commit that introduced it on this branch.
 * Same modal mechanics as the model picker (focus trap, Esc, backdrop click).
 */
export default function BlameSheet({
  view,
  onClose,
}: {
  view: BlameView;
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
            <LuX aria-hidden="true" />
          </button>
        </header>

        <div className="cg-blame-body">
          <blockquote className="cg-blame-claim">{view.claim}</blockquote>
          {view.sample ? (
            <p className="cg-empty-note">
              This message is not part of the branch&apos;s committed history (it is sample
              transcript shown for context).
            </p>
          ) : (
            <div className="cg-fields">
              <Field label="Commit">
                <span className="cg-mono">{view.commitId.slice(0, 7)}</span>
              </Field>
              <Field label="Kind">{view.kind}</Field>
              <Field label="Role">{view.role}</Field>
              <Field label="Model">{view.model}</Field>
              <Field label="Author">{view.author ?? "—"}</Field>
              <Field label="Summary">{view.summary ?? "—"}</Field>
              <Field label="Branch">{view.branch}</Field>
              <Field label="Created">{view.createdAt.slice(0, 19).replace("T", " ")}</Field>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
