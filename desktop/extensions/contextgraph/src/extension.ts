/**
 * ContextGit Graph — the conversation history (commits, branches, merges) as a
 * GitHub-style graph inside the editor. A webview panel, fed by the local
 * ContextGit backend (the extension host does the fetch, so there is no CORS).
 */
import * as vscode from "vscode";

interface Commit {
  id: string;
  parent_ids: string[];
  kind: string;
  summary?: string | null;
  model?: string | null;
  created_at: string;
  messages?: unknown[];
  token_count?: number;
}

interface Branch {
  name: string;
  head_commit_id: string;
}

let panel: vscode.WebviewPanel | undefined;

function backendUrl(): string {
  return String(
    vscode.workspace.getConfiguration("contextgitGraph").get("backendUrl") ?? "",
  ).replace(/\/+$/, "");
}

async function loadGraph(): Promise<void> {
  if (!panel) return;
  const base = backendUrl();
  const get = async (route: string): Promise<unknown> => {
    // Retry a couple of times: the backend reloads while you work (uvicorn
    // --reload), and a request landing mid-restart returns 500/connection-refused.
    let lastError = `${route} → no response`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      try {
        const token = process.env.CONTEXTGIT_API_TOKEN;
        const response = await fetch(`${base}${route}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (response.ok) return response.json();
        // Never `.json()` an error body — surface the status and text instead.
        lastError = `${route} → ${response.status} ${(await response.text()).slice(0, 160)}`;
      } catch (error) {
        lastError = `${route} → ${String(error)}`;
      }
    }
    throw new Error(lastError);
  };
  try {
    const [snapshot, raw] = await Promise.all([get("/api/v1/repo"), get("/api/v1/commits")]);
    // /commits returns { commit, token_count, context_message_count } wrappers.
    const commits = (Array.isArray(raw) ? raw : []).map((entry) => {
      const record = entry as { commit?: Commit };
      return record.commit ?? (entry as Commit);
    });
    void panel.webview.postMessage({ type: "data", snapshot, commits });
  } catch (error) {
    void panel.webview.postMessage({ type: "error", message: String(error) });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("contextgitGraph.show", () => {
      if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
        void loadGraph();
        return;
      }
      panel = vscode.window.createWebviewPanel(
        "contextgitGraph",
        "Context graph",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      panel.webview.html = html();
      panel.webview.onDidReceiveMessage((message: { type?: string }) => {
        if (message?.type === "ready" || message?.type === "refresh") void loadGraph();
      });
      panel.onDidDispose(() => {
        panel = undefined;
      });
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("contextgitGraph.refresh", () => void loadGraph()),
  );
}

export function deactivate(): void {
  panel = undefined;
}

function html(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.5 var(--vscode-font-family, sans-serif); color: var(--vscode-foreground); margin: 0; }
  header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border, #333); }
  header h1 { font-size: 13px; margin: 0; font-weight: 600; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; border-radius: 4px; padding: 3px 10px; cursor: pointer; }
  .rows { padding: 6px 0; }
  .row { display: grid; grid-template-columns: 64px 1fr auto; gap: 8px; align-items: center; padding: 3px 12px; }
  .row:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,.06)); }
  .msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { opacity: .6; font-size: 11px; white-space: nowrap; }
  .chip { border: 1px solid var(--vscode-panel-border, #444); border-radius: 999px; padding: 0 7px; font-size: 11px; margin-left: 6px; opacity: .85; }
  .kind { opacity: .7; font-size: 11px; }
  .empty, .error { padding: 16px; opacity: .7; }
</style></head>
<body>
  <header>
    <h1>Context graph</h1>
    <span id="count" class="meta"></span>
    <span style="flex:1"></span>
    <button id="refresh">Refresh</button>
  </header>
  <div id="rows" class="rows"><p class="empty">Loading…</p></div>
  <script>
    const vscode = acquireVsCodeApi();
    const rows = document.getElementById("rows");
    const count = document.getElementById("count");
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>\"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
      })[char]);
    }
    document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));

    function hash(id) { return (id || "").slice(0, 7); }
    function when(iso) {
      const t = new Date(iso).getTime();
      if (!t) return "";
      const mins = Math.round((Date.now() - t) / 60000);
      if (mins < 60) return mins + "m ago";
      if (mins < 1440) return Math.round(mins / 60) + "h ago";
      return Math.round(mins / 1440) + "d ago";
    }

    // Lane assignment: newest first, first parent inherits the lane, extra parents fork.
    function computeLanes(commits) {
      const active = [];
      const lane = {};
      for (const commit of commits) {
        const parents = commit.parent_ids || [];
        let index = active.indexOf(commit.id);
        if (index === -1) { index = active.length; active.push(commit.id); }
        lane[commit.id] = index;
        active[index] = parents[0] || null;
        for (const parent of parents.slice(1)) {
          let free = active.indexOf(null);
          if (free === -1) { free = active.length; active.push(parent); } else { active[free] = parent; }
        }
      }
      return lane;
    }

    function render(snapshot, commits) {
      const list = [...(commits || [])].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      const lane = computeLanes(list);
      const maxLane = Math.max(0, ...Object.values(lane));
      const branchesByCommit = {};
      for (const branch of (snapshot && snapshot.branches) || []) {
        (branchesByCommit[branch.head_commit_id] ||= []).push(branch.name);
      }
      count.textContent = list.length + " commits · " + (((snapshot && snapshot.branches) || []).length) + " branches";
      if (list.length === 0) { rows.innerHTML = '<p class="empty">No commits yet.</p>'; return; }
      const palette = ["#ff6a3d", "#46b89c", "#5aa9ff", "#a394ff", "#e0a53a", "#ff6b5e", "#7fd06a", "#d98cff"];
      rows.innerHTML = "";
      for (const commit of list) {
        const x = 12 + (lane[commit.id] || 0) * 12;
        const color = palette[(lane[commit.id] || 0) % palette.length];
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML =
          '<svg width="64" height="20">' +
            '<circle cx="' + x + '" cy="10" r="4" fill="' + color + '"></circle>' +
            '<line x1="' + x + '" y1="0" x2="' + x + '" y2="20" stroke="' + color + '" stroke-width="1.5" opacity="0.5"></line>' +
          '</svg>' +
          '<span class="msg"><span class="kind">' + escapeHtml(commit.kind || "") + '</span> ' +
            escapeHtml(commit.summary || "(no summary)") +
            ((branchesByCommit[commit.id] || []).map((n) => '<span class="chip">' + escapeHtml(n) + "</span>").join("")) +
          '</span>' +
          '<span class="meta">' + escapeHtml(hash(commit.id)) + " · " + escapeHtml(when(commit.created_at)) + '</span>';
        rows.appendChild(row);
      }
    }

    window.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "data") render(message.snapshot, message.commits);
      else if (message.type === "error") rows.innerHTML = '<p class="error">' + escapeHtml(message.message) + "</p>";
    });
    vscode.postMessage({ type: "ready" });
  </script>
</body></html>`;
}
