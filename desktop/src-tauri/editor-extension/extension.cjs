const vscode = require("vscode");
const fs = require("node:fs");

// This integration only reports lifecycle state. Editing, rendering, language
// services, extensions and recovery remain owned by the full VS Code workbench.
exports.activate = async function activate(context) {
  const path = process.env.CONTEXTGIT_EDITOR_STATE_FILE;
  const instanceId = process.env.CONTEXTGIT_EDITOR_INSTANCE;
  if (!path || !instanceId) return;
  const restorePath = process.env.CONTEXTGIT_EDITOR_RESTORE_FILE || `${path}.restore`;
  let timer;
  let lastDirty;
  let restoring = true;
  let disposed = false;
  let lastLayout;
  const dirty = () => vscode.workspace.textDocuments.some(document => document.isDirty)
    || vscode.workspace.notebookDocuments.some(document => document.isDirty)
    || vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.isDirty));
  const snapshot = () => {
    if (disposed) return;
    const isDirty = dirty();
    const files = vscode.window.tabGroups.all.flatMap(group => group.tabs.flatMap(tab =>
      tab.input instanceof vscode.TabInputText ? [{ uri: tab.input.uri.toString(), column: group.viewColumn }] : []));
    const editor = vscode.window.activeTextEditor;
    const active = editor && { uri: editor.document.uri.toString(), line: editor.selection.active.line, character: editor.selection.active.character, top: editor.visibleRanges[0]?.start.line ?? 0 };
    const state = { instanceId, dirty: isDirty || restoring, updatedAt: Date.now(), files, active };
    try {
      fs.writeFileSync(`${path}.tmp`, JSON.stringify(state));
      fs.renameSync(`${path}.tmp`, path);
      // Retain only a clean layout for restoration; never serialize file text.
      if (!state.dirty) {
        const layout = JSON.stringify({ files, active });
        if (layout !== lastLayout) {
          fs.writeFileSync(`${restorePath}.tmp`, JSON.stringify(state));
          fs.renameSync(`${restorePath}.tmp`, restorePath);
          lastLayout = layout;
        }
      }
      lastDirty = isDirty;
    } catch { /* Unknown state makes the supervisor retain the editor safely. */ }
  };
  const changed = () => {
    clearTimeout(timer);
    // Only a clean/dirty transition needs immediate I/O, not every keystroke.
    if (dirty() !== lastDirty) snapshot();
    else timer = setTimeout(snapshot, 1000);
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(changed),
    vscode.workspace.onDidSaveTextDocument(changed),
    vscode.workspace.onDidCloseTextDocument(changed),
    vscode.workspace.onDidChangeNotebookDocument(changed),
    vscode.window.tabGroups.onDidChangeTabs(changed),
    vscode.window.onDidChangeActiveTextEditor(changed),
    vscode.window.onDidChangeTextEditorSelection(changed),
    vscode.window.onDidChangeTextEditorVisibleRanges(changed),
  );
  snapshot();
  try {
    const previous = JSON.parse(fs.readFileSync(restorePath, "utf8"));
    const hasFiles = vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input instanceof vscode.TabInputText));
    if (!hasFiles && !previous.dirty) {
      for (const file of (previous.files ?? []).slice(0, 50)) {
        try { await vscode.window.showTextDocument(vscode.Uri.parse(file.uri), { viewColumn: file.column, preview: false, preserveFocus: true }); } catch { /* Deleted files are skipped. */ }
      }
      if (previous.active) {
        try {
          const active = previous.active;
          const editor = await vscode.window.showTextDocument(vscode.Uri.parse(active.uri), { preview: false });
          const position = new vscode.Position(active.line, active.character);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(active.top, 0, active.top, 0), vscode.TextEditorRevealType.AtTop);
        } catch { /* Preserve the successfully restored documents. */ }
      }
    }
  } catch { /* First launch has no saved layout. */ }
  restoring = false;
  snapshot();
  // A stale or crashed reporter must never authorize destructive idle cleanup.
  const heartbeat = setInterval(snapshot, 10000);
  context.subscriptions.push({ dispose() {
    disposed = true; clearInterval(heartbeat); clearTimeout(timer);
    try { fs.writeFileSync(path, JSON.stringify({ instanceId, dirty: true, updatedAt: 0 })); } catch {}
  } });
};
