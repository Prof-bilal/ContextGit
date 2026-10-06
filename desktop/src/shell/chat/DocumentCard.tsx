import { useState } from "react";
import { LuDownload } from "react-icons/lu";

import type { DocumentFormat, RenderedDocument } from "@/lib/api";
import { Chip } from "../primitives";
import { saveDocument } from "./downloadDocument";

export const DOCUMENT_FORMAT_LABEL: Record<DocumentFormat, string> = {
  md: "Markdown",
  pdf: "PDF",
  docx: "Word",
  pptx: "Slides",
};
const FORMAT_LABEL = DOCUMENT_FORMAT_LABEL;

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${bytes} B`;
}

/**
 * A generated document: the model's markdown while it streams, then the rendered
 * file with a Download button (native Save dialog in the desktop app, a browser
 * download in the web build).
 */
export default function DocumentCard({
  format,
  markdown,
  document,
  error,
  done,
}: {
  format: DocumentFormat;
  markdown: string;
  document: RenderedDocument | null;
  error: string | null;
  done: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const download = async () => {
    if (!document || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const path = await saveDocument(document);
      if (path) setSaved(path);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Could not save the file");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cg-block cg-doc" aria-label="Generated document">
      <header className="cg-block-head">
        <span className="cg-kicker">Document</span>
        <Chip>{FORMAT_LABEL[format]}</Chip>
        {document && <span className="cg-view-sub">{formatSize(document.size)}</span>}
        <span className="cg-toolbar-spacer" />
        {document && (
          <button
            type="button"
            className="cg-btn cg-btn-sm"
            data-variant="primary"
            disabled={saving}
            onClick={() => void download()}
          >
            <LuDownload aria-hidden="true" /> {saving ? "Saving…" : "Download"}
          </button>
        )}
      </header>

      {document && <p className="cg-doc-title">{document.title}</p>}

      {(markdown || !document) && (
        <pre className="cg-doc-preview" aria-live="polite">
          {markdown}
          {!done && !error && <span className="cg-caret" aria-hidden="true">▍</span>}
        </pre>
      )}

      {error && <p className="cg-pane-error">⚠ {error}</p>}
      {saveError && <p className="cg-pane-error">⚠ {saveError}</p>}
      {saved && <p className="cg-view-sub">Saved to {saved}</p>}
      {!document && !error && (
        <span className="cg-thinking">
          <span className="cg-thinking-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {done ? "preparing…" : "writing…"}
        </span>
      )}
    </section>
  );
}
