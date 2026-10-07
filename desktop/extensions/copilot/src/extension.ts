/**
 * ContextGit Copilot — Copilot-style inline completions for the embedded editor.
 *
 * This is a thin client: it reads the code around the cursor and asks the
 * ContextGit backend (`POST /api/v1/code/complete`) for the text to insert.
 * All provider keys and model choices live in the app, never here.
 */
import * as vscode from "vscode";

const MAX_PREFIX_LINES = 120;
const MAX_SUFFIX_LINES = 40;

let status: vscode.StatusBarItem | undefined;

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("contextgitCopilot");
}

function tailLines(text: string, count: number): string {
  const lines = text.split("\n");
  return lines.length <= count ? text : lines.slice(-count).join("\n");
}

function headLines(text: string, count: number): string {
  const lines = text.split("\n");
  return lines.length <= count ? text : lines.slice(0, count).join("\n");
}

async function requestCompletion(
  prefix: string,
  suffix: string,
  document: vscode.TextDocument,
  token: vscode.CancellationToken,
): Promise<string> {
  const settings = config();
  const base = String(settings.get("backendUrl") ?? "").replace(/\/+$/, "");
  if (!base) return "";

  const controller = new AbortController();
  const subscription = token.onCancellationRequested(() => controller.abort());
  try {
    const response = await fetch(`${base}/api/v1/code/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider_id: String(settings.get("providerId") ?? ""),
        model: String(settings.get("model") ?? "") || undefined,
        language: document.languageId,
        filename: document.fileName,
        prefix,
        suffix,
        max_tokens: Number(settings.get("maxTokens") ?? 128),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return "";
    const data = (await response.json()) as { text?: unknown };
    return typeof data.text === "string" ? data.text : "";
  } catch {
    return "";
  } finally {
    subscription.dispose();
  }
}

class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const settings = config();
    if (!settings.get("enabled")) return [];
    const languages = settings.get<string[]>("languages") ?? [];
    if (languages.length > 0 && !languages.includes(document.languageId)) return [];

    // Debounce so a fast typist does not fire a request per keystroke.
    await new Promise((resolve) => setTimeout(resolve, Number(settings.get("debounceMs") ?? 300)));
    if (token.isCancellationRequested) return [];

    const end = document.positionAt(document.getText().length);
    const prefix = tailLines(document.getText(new vscode.Range(new vscode.Position(0, 0), position)), MAX_PREFIX_LINES);
    const suffix = headLines(document.getText(new vscode.Range(position, end)), MAX_SUFFIX_LINES);
    if (prefix.trim().length === 0 && suffix.trim().length === 0) return [];

    if (status) status.text = "$(sync~spin) ContextGit";
    try {
      const text = await requestCompletion(prefix, suffix, document, token);
      if (!text || token.isCancellationRequested) return [];
      return [new vscode.InlineCompletionItem(text)];
    } finally {
      if (status) status.text = "$(sparkle) ContextGit";
    }
  }
}

export function activate(context: vscode.ExtensionContext): void {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = "$(sparkle) ContextGit";
  status.tooltip = "ContextGit inline completions";
  status.command = "contextgitCopilot.toggle";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, new InlineCompletionProvider()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("contextgitCopilot.toggle", async () => {
      const next = !config().get("enabled");
      await config().update("enabled", next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`ContextGit completions ${next ? "on" : "off"}`, 2000);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("contextgitCopilot.completeNow", () => {
      void vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    }),
  );
}

export function deactivate(): void {
  // nothing to clean up; subscriptions are disposed by VS Code
}
