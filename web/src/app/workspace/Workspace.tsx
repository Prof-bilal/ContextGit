/**
 * OWNER: workspace agent. Terminal / Files / Changes / App tabs for one session.
 *
 * The Changes tab needs a working-tree diff endpoint that does not exist yet.
 * `GET /api/v1/sessions/{id}/workspace` only returns `changed_files: string[]`
 * (no per-file A/M/D status and no diff text). Until that endpoint ships this
 * tab lists the changed paths and says that diffs are coming.
 *
 * Missing endpoint spec:
 *   GET /api/v1/sessions/{id}/diff?path=<optional project-relative path>
 *   200 {
 *     base: string;                 // session.base_commit, or HEAD when null
 *     files: Array<{
 *       path: string;
 *       status: "A" | "M" | "D";    // added / modified / deleted
 *       additions: number;
 *       deletions: number;
 *       binary: boolean;
 *       diff: string;               // unified diff; "" when binary
 *     }>;
 *   }
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuExternalLink,
  LuFile,
  LuFolder,
  LuFolderTree,
  LuGitCompare,
  LuGlobe,
  LuRefreshCw,
  LuRotateCw,
  LuSearch,
  LuSquareTerminal,
} from "react-icons/lu";
import { projectApi, type Session, type WorkspaceStatus } from "@/shared/api";
import type { FileNode } from "@/shared/workspaceFiles";
import EmbeddedTerminal from "../../shell/terminal/EmbeddedTerminal";
import { terminalRuntime } from "../../shell/terminal/runtime";
import { Button, EmptyState, IconButton, Tabs, type TabItem } from "../ui";
import "./workspace.css";

type Tab = "terminal" | "files" | "changes" | "app";

const TABS: TabItem<Tab>[] = [
  { id: "terminal", label: "Terminal", icon: <LuSquareTerminal aria-hidden="true" /> },
  { id: "files", label: "Files", icon: <LuFolderTree aria-hidden="true" /> },
  { id: "changes", label: "Changes", icon: <LuGitCompare aria-hidden="true" /> },
  { id: "app", label: "App", icon: <LuGlobe aria-hidden="true" /> },
];

export default function Workspace({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>("terminal");
  const [refresh, setRefresh] = useState(0);
  const [terminalError, setTerminalError] = useState("");
  const project = session.worktree_path ?? session.project_path ?? "";

  // Show saved output for finished runs. Never start a process just because a
  // session view was opened; resuming stays an explicit button press.
  useEffect(() => {
    if (terminalRuntime.session(session.id)) return;
    if (["done", "error"].includes(session.status))
      void terminalRuntime.restore(session);
  }, [session]);

  // The terminal stays mounted while another tab is active. Re-fit once it is
  // visible again; EmbeddedTerminal also reacts to its ResizeObserver.
  useEffect(() => {
    if (tab !== "terminal") return;
    const frame = requestAnimationFrame(() =>
      window.dispatchEvent(new Event("resize")),
    );
    return () => cancelAnimationFrame(frame);
  }, [tab]);

  const resume = useCallback(() => {
    setTerminalError("");
    const existing = terminalRuntime.session(session.id);
    if (existing) {
      if (["idle", "exited", "error"].includes(terminalRuntime.snapshot(session.id).state))
        void terminalRuntime
          .retry(session.id)
          .catch(cause => setTerminalError(String(cause)));
      return;
    }
    if (["done", "error"].includes(session.status)) {
      void terminalRuntime.restore(session);
      return;
    }
    void terminalRuntime
      .ensure(session)
      .catch(cause => setTerminalError(String(cause)));
  }, [session]);

  return (
    <section className="ws-root">
      <header className="ws-top">
        <Tabs items={TABS} value={tab} onChange={setTab} label="Workspace" />
        <div className="ws-toolbar">
          {(tab === "files" || tab === "changes") && (
            <IconButton
              label={tab === "files" ? "Refresh files" : "Refresh changes"}
              icon={<LuRefreshCw aria-hidden="true" />}
              onClick={() => setRefresh(value => value + 1)}
            />
          )}
        </div>
      </header>
      <div className="ws-body">
        <div className="ws-pane ws-terminal" data-active={tab === "terminal"}>
          {terminalError && (
            <div className="ws-banner ui-error" role="alert">{terminalError}</div>
          )}
          <div className="ws-terminal-body">
            <EmbeddedTerminal sessionId={session.id} onResume={resume} />
          </div>
        </div>
        {tab === "files" &&
          (project
            ? <FilesPane project={project} refresh={refresh} />
            : (
              <div className="ws-pane ws-centered">
                <EmptyState title="No folder">
                  This session has no project folder to browse.
                </EmptyState>
              </div>
            ))}
        {tab === "changes" && <ChangesPane session={session} refresh={refresh} />}
        {tab === "app" && <AppPane session={session} />}
      </div>
    </section>
  );
}

type Preview = Awaited<
  ReturnType<NonNullable<typeof window.contextgit>["filePreview"]>
>;

function FilesPane({ project, refresh }: { project: string; refresh: number }) {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [directory, setDirectory] = useState("");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [doc, setDoc] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const listSeq = useRef(0);
  const fileSeq = useRef(0);

  const load = useCallback(async (path: string) => {
    const bridge = window.contextgit;
    if (!bridge) {
      setError("File access needs the local ContextGit bridge.");
      setLoading(false);
      return;
    }
    const ticket = ++listSeq.current;
    setLoading(true);
    setError("");
    try {
      const next = await bridge.filesList(project, path);
      if (ticket !== listSeq.current) return;
      setNodes(next);
      setDirectory(path);
      setSearching(false);
    } catch (cause) {
      if (ticket === listSeq.current) setError(String(cause));
    } finally {
      if (ticket === listSeq.current) setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load("");
  }, [load, refresh]);

  const search = useCallback(async () => {
    const term = query.trim();
    if (!term) {
      await load(directory);
      return;
    }
    const bridge = window.contextgit;
    if (!bridge) {
      setError("File access needs the local ContextGit bridge.");
      return;
    }
    const ticket = ++listSeq.current;
    const queue = [""];
    const matches: FileNode[] = [];
    let visited = 0;
    setLoading(true);
    setError("");
    try {
      while (queue.length && visited++ < 500) {
        const entries = await bridge.filesList(project, queue.shift());
        for (const entry of entries) {
          if (entry.path.toLowerCase().includes(term.toLowerCase()))
            matches.push(entry);
          if (entry.kind === "directory") queue.push(entry.path);
        }
      }
      if (ticket !== listSeq.current) return;
      setNodes(matches.slice(0, 250));
      setSearching(true);
    } catch (cause) {
      if (ticket === listSeq.current) setError(String(cause));
    } finally {
      if (ticket === listSeq.current) setLoading(false);
    }
  }, [directory, load, project, query]);

  const open = useCallback(async (path: string) => {
    const bridge = window.contextgit;
    if (!bridge) {
      setError("File access needs the local ContextGit bridge.");
      return;
    }
    const ticket = ++fileSeq.current;
    setError("");
    try {
      const next = await bridge.filePreview(project, path);
      if (ticket === fileSeq.current) setDoc(next);
    } catch (cause) {
      if (ticket === fileSeq.current) {
        setDoc(null);
        setError(String(cause));
      }
    }
  }, [project]);

  const parent = directory.split("/").slice(0, -1).join("/");

  return (
    <div className="ws-pane ws-files">
      <aside className="ws-file-list">
        <form
          className="ws-search"
          onSubmit={event => {
            event.preventDefault();
            void search();
          }}
        >
          <LuSearch aria-hidden="true" />
          <input
            className="ui-input"
            aria-label="Search files"
            placeholder="Search files…"
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
        </form>
        <div className="ws-crumbs">
          <button
            type="button"
            className="ws-crumb"
            disabled={!directory && !searching}
            title={searching ? "Back to files" : directory || "Project root"}
            onClick={() => void load(searching ? directory : parent)}
          >
            <LuArrowLeft aria-hidden="true" />
            <span>{searching ? "Back to files" : directory || "Project root"}</span>
          </button>
        </div>
        {error && <p className="ws-list-error ui-error" role="alert">{error}</p>}
        <div className="ws-nodes app-scroll">
          {loading && <p className="ws-muted">Loading…</p>}
          {!loading && !error && nodes.length === 0 && (
            <p className="ws-muted">{searching ? "No matching files." : "This folder is empty."}</p>
          )}
          {nodes.map(node => (
            <button
              key={node.path}
              type="button"
              className="ws-node"
              data-kind={node.kind}
              aria-current={doc?.path === node.path ? "true" : undefined}
              title={node.path}
              onClick={() => void (node.kind === "directory" ? load(node.path) : open(node.path))}
            >
              {node.kind === "directory"
                ? <LuFolder aria-hidden="true" />
                : <LuFile aria-hidden="true" />}
              <span className="ws-node-name">{node.name}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="ws-viewer">
        <header className="ws-viewer-head">
          <span className="ws-viewer-path" title={doc?.path}>
            {doc?.path ?? (searching ? "Search results" : directory || "Project root")}
          </span>
          {doc && (
            <span className="ws-viewer-meta">
              {doc.size.toLocaleString()} bytes · {doc.kind}
            </span>
          )}
        </header>
        <div className="ws-viewer-body app-scroll">
          {!doc
            ? (
              <div className="ws-fill">
                <EmptyState title="Select a file">
                  Choose a file on the left to read it here.
                </EmptyState>
              </div>
            )
            : doc.kind === "image"
              ? (
                <div className="ws-image">
                  <img src={doc.content} alt={doc.path} />
                </div>
              )
              : (
                <div className="ws-code">
                  {doc.content.split("\n").map((raw, index) => {
                    const line = raw.replace(/\r$/, "");
                    const tone = doc.kind !== "diff"
                      ? ""
                      : line.startsWith("+")
                        ? " ws-code-add"
                        : line.startsWith("-")
                          ? " ws-code-del"
                          : "";
                    return (
                      <div key={index} className={`ws-code-line${tone}`}>
                        <span className="ws-code-no" aria-hidden="true">{index + 1}</span>
                        <span className="ws-code-text">{line || " "}</span>
                      </div>
                    );
                  })}
                </div>
              )}
        </div>
      </section>
    </div>
  );
}

function ChangesPane({ session, refresh }: { session: Session; refresh: number }) {
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(
        await projectApi(session.project_path ?? undefined).workspace(session.id),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [session.id, session.project_path]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  const changed = status?.changed_files ?? [];

  return (
    <div className="ws-pane ws-changes">
      <aside className="ws-changed-list">
        <div className="ws-changed-head">
          <span>Changes</span>
          <span className="ws-count">{changed.length}</span>
        </div>
        <div className="ws-changed-body app-scroll">
          {error && <p className="ui-error" role="alert">{error}</p>}
          {loading && !status && <p className="ws-muted">Loading changes…</p>}
          {!loading && !error && changed.length === 0 && (
            <p className="ws-muted">No changes.</p>
          )}
          {changed.map(path => (
            <div className="ws-changed-item" key={path} title={path}>
              <span className="ws-change-dot" aria-hidden="true" />
              <span className="ws-changed-path">{path}</span>
            </div>
          ))}
        </div>
      </aside>
      <div className="ws-diff">
        {!loading && !error && changed.length === 0 && (
          <EmptyState title="No changes yet">
            Files this run edits will be listed here.
          </EmptyState>
        )}
        {!loading && !error && changed.length > 0 && (
          <EmptyState title="Diffs are coming">
            The changed files are listed on the left. The backend does not
            expose a working-tree diff yet.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

function AppPane({ session }: { session: Session }) {
  if (session.port == null)
    return (
      <div className="ws-pane ws-centered">
        <EmptyState title="Nothing is being served">
          Apps the agent starts appear here. When it serves a port, the preview
          opens in this tab.
        </EmptyState>
      </div>
    );
  return <AppFrame key={session.port} port={session.port} />;
}

function AppFrame({ port }: { port: number }) {
  const base = `http://127.0.0.1:${port}`;
  const [src, setSrc] = useState(base);
  const [draft, setDraft] = useState(base);
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="ws-pane ws-app">
      <form
        className="ws-address"
        onSubmit={event => {
          event.preventDefault();
          const next = draft.trim() || base;
          setSrc(/^https?:\/\//i.test(next) ? next : `http://${next}`);
          setReloadKey(value => value + 1);
        }}
      >
        <input
          className="ui-input"
          aria-label="App address"
          value={draft}
          spellCheck={false}
          onChange={event => setDraft(event.target.value)}
        />
        <IconButton
          label="Reload app"
          icon={<LuRotateCw aria-hidden="true" />}
          onClick={() => setReloadKey(value => value + 1)}
        />
        <Button
          icon={<LuExternalLink aria-hidden="true" />}
          onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
        >
          Open in new tab
        </Button>
      </form>
      <iframe
        key={reloadKey}
        className="ws-frame"
        src={src}
        title={`App on port ${port}`}
      />
    </div>
  );
}
