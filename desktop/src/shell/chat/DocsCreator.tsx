import { useCallback, useEffect, useRef, useState } from "react";
import { LuDownload, LuRefreshCw } from "react-icons/lu";

import {
  api,
  streamDocument,
  type DocumentEvent,
  type DocumentInfo,
  type ProviderInfo,
  type RenderedDocument,
} from "@/lib/api";
import {
  DOCUMENT_FORMATS,
  DOCUMENT_TEMPLATES,
  type DocumentFormat,
  type DocumentTemplate,
} from "../../mock/chat";
import type { ModelSelection } from "../providers";
import { Chip, IconButton } from "../primitives";
import DocumentCard, { DOCUMENT_FORMAT_LABEL } from "./DocumentCard";
import { saveDocument } from "./downloadDocument";

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${bytes} B`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

/**
 * The Docs workspace: ask the assistant to write a document on a topic, pick a
 * format, and download it — plus a library of everything generated so far.
 */
export default function DocsCreator({
  selection,
  provider,
  branch,
  sessionId,
  commitId,
  onCommitted,
  onStaged,
}: {
  selection: ModelSelection;
  provider: ProviderInfo | undefined;
  branch: string;
  sessionId: string | null;
  commitId: string | null;
  onCommitted?: () => void;
  onStaged?: () => void;
}) {
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("pdf");
  const [template, setTemplate] = useState<DocumentTemplate>("report");
  const [running, setRunning] = useState(false);
  const [markdown, setMarkdown] = useState("");
  const [document, setDocument] = useState<RenderedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [library, setLibrary] = useState<DocumentInfo[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const loadLibrary = useCallback(async () => {
    try {
      setLibrary(await api.documents());
      setLibraryError(null);
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : "Could not load documents");
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const canCreate =
    topic.trim().length > 0 &&
    !running &&
    Boolean(provider) &&
    Boolean(selection.modelId) &&
    Boolean(branch);

  const create = async () => {
    const text = topic.trim();
    if (!text || !canCreate) return;
    setRunning(true);
    setMarkdown("");
    setDocument(null);
    setError(null);
    setDone(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamDocument(
        {
          prompt: text,
          format,
          template,
          provider: selection.providerId || undefined,
          model: selection.modelId || undefined,
          branch,
          commitId,
          ...(sessionId ? { sessionId, autoCommit: false } : {}),
        },
        (event: DocumentEvent) => {
          if (event.type === "token") setMarkdown((current) => current + event.text);
          else if (event.type === "document") setDocument(event);
          else if (event.type === "error") setError(event.error);
          else if (event.type === "done") {
            setDone(true);
            if (event.staged) onStaged?.();
            else onCommitted?.();
          }
        },
        controller.signal,
      );
      await loadLibrary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document generation failed");
      setDone(true);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const download = async (item: DocumentInfo) => {
    if (busyId) return;
    setBusyId(item.id);
    setLibraryError(null);
    try {
      await saveDocument(item);
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : "Could not save the file");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="cg-docs" aria-label="Document creator">
      <div className="cg-view-toolbar">
        <h1>Docs</h1>
        <span className="cg-view-sub">
          {provider ? `Writing with ${provider.label}` : "Connect a model to generate"}
        </span>
        <span className="cg-toolbar-spacer" />
        <IconButton label="Refresh library" onClick={() => void loadLibrary()}>
          <LuRefreshCw aria-hidden="true" />
        </IconButton>
      </div>

      <section className="cg-docs-form" aria-label="Create a document">
        <label className="cg-kicker" htmlFor="cg-doc-topic">
          What should the document be about?
        </label>
        <textarea
          id="cg-doc-topic"
          className="cg-text-input"
          rows={3}
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="e.g. a 6-slide deck introducing token-bucket rate limiting"
        />
        <div className="cg-docs-controls">
          <select
            className="cg-mini-select"
            aria-label="Document format"
            value={format}
            onChange={(event) => setFormat(event.target.value as DocumentFormat)}
          >
            {DOCUMENT_FORMATS.map((entry) => (
              <option key={entry.value} value={entry.value} title={entry.hint}>
                {entry.label}
              </option>
            ))}
          </select>
          <select
            className="cg-mini-select"
            aria-label="Document style"
            value={template}
            onChange={(event) => setTemplate(event.target.value as DocumentTemplate)}
          >
            {DOCUMENT_TEMPLATES.map((entry) => (
              <option key={entry.value} value={entry.value} title={entry.hint}>
                {entry.label}
              </option>
            ))}
          </select>
          <span className="cg-toolbar-spacer" />
          <button
            type="button"
            className="cg-btn"
            data-variant="primary"
            disabled={!canCreate}
            onClick={() => void create()}
          >
            {running ? "Generating…" : "Create document"}
          </button>
        </div>
        {!provider && (
          <p className="cg-empty-note">
            Document generation uses your selected chat model — add a provider first.
          </p>
        )}
      </section>

      {(markdown || document || error) && (
        <DocumentCard
          format={format}
          markdown={markdown}
          document={document}
          error={error}
          done={done}
        />
      )}

      <section className="cg-docs-library" aria-label="Generated documents">
        <header className="cg-block-head">
          <span className="cg-kicker">Library</span>
          <span className="cg-view-sub">{library.length} document(s)</span>
        </header>
        {libraryError && <p className="cg-pane-error">{libraryError}</p>}
        <ul className="cg-doclib">
          {library.map((item) => (
            <li key={item.id} className="cg-doclib-row">
              <span className="cg-doclib-copy">
                <span className="cg-doclib-title">{item.title || item.filename}</span>
                <span className="cg-view-sub">
                  {DOCUMENT_FORMAT_LABEL[item.format]} · {formatSize(item.size)} ·{" "}
                  {formatDate(item.created_at)}
                </span>
              </span>
              <span className="cg-toolbar-spacer" />
              <Chip>{item.format}</Chip>
              <button
                type="button"
                className="cg-btn cg-btn-sm"
                disabled={busyId === item.id}
                onClick={() => void download(item)}
              >
                <LuDownload aria-hidden="true" /> {busyId === item.id ? "Saving…" : "Download"}
              </button>
            </li>
          ))}
          {library.length === 0 && (
            <li className="cg-empty-note">No documents yet — create one above.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
