import * as monaco from "monaco-editor";
// monaco's `exports` map rewrites subpaths to `esm/vs/*`, so the worker
// specifiers drop the `esm/vs/` prefix rather than repeating it.
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";

// Monaco runs its language services in web workers. Vite hands us bundled
// worker constructors; the API tab only ever asks for the generic editor and
// the JSON worker (which is what underlines JSON errors), so everything else
// falls back to the generic one.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId, label) {
    return label === "json" ? new JsonWorker() : new EditorWorker();
  },
};

// Two editor themes that sit flush inside the shell's dark / paper ramps.
monaco.editor.defineTheme("cg-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "string.key.json", foreground: "ffb38a" },
    { token: "string.value.json", foreground: "a8d6a0" },
    { token: "number", foreground: "8fb8ff" },
    { token: "keyword.json", foreground: "ff8a5c" },
    { token: "delimiter", foreground: "918879" },
  ],
  colors: {
    "editor.background": "#191612",
    "editor.foreground": "#f4efe6",
    "editorLineNumber.foreground": "#5f574c",
    "editorLineNumber.activeForeground": "#c6bdb1",
    "editor.lineHighlightBackground": "#211d18",
    "editor.lineHighlightBorder": "#00000000",
    "editorCursor.foreground": "#ff6a3d",
    "editor.selectionBackground": "#ff6a3d40",
    "editor.inactiveSelectionBackground": "#ff6a3d22",
    "editorIndentGuide.background1": "#2a251f",
    "editorIndentGuide.activeBackground1": "#4e463b",
    "editorWidget.background": "#211d18",
    "editorWidget.border": "#3a332b",
    "editorSuggestWidget.background": "#211d18",
    "editorSuggestWidget.border": "#3a332b",
    "editorSuggestWidget.selectedBackground": "#342e26",
    "editorBracketMatch.background": "#342e26",
    "editorBracketMatch.border": "#4e463b",
    "editorError.foreground": "#ff6b5e",
    "editorWarning.foreground": "#e0a53a",
    "scrollbarSlider.background": "#4e463b55",
    "scrollbarSlider.hoverBackground": "#4e463b88",
    "scrollbarSlider.activeBackground": "#4e463bbb",
  },
});

monaco.editor.defineTheme("cg-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "string.key.json", foreground: "b8532a" },
    { token: "string.value.json", foreground: "2f7d4f" },
    { token: "number", foreground: "2f5fd0" },
    { token: "keyword.json", foreground: "c4401a" },
    { token: "delimiter", foreground: "6a6674" },
  ],
  colors: {
    "editor.background": "#fbf9f4",
    "editor.foreground": "#201f2b",
    "editorLineNumber.foreground": "#b3a992",
    "editorLineNumber.activeForeground": "#4a4856",
    "editor.lineHighlightBackground": "#f3eee4",
    "editorCursor.foreground": "#e8572b",
    "editor.selectionBackground": "#ff6a3d33",
    "editorIndentGuide.background1": "#ece6d9",
    "editorIndentGuide.activeBackground1": "#c9c1b1",
    "editorWidget.background": "#fbf9f4",
    "editorWidget.border": "#ded6c6",
    "editorSuggestWidget.background": "#ffffff",
    "editorSuggestWidget.border": "#ded6c6",
    "editorSuggestWidget.selectedBackground": "#ece6d9",
    "editorBracketMatch.background": "#ece6d9",
    "editorBracketMatch.border": "#c9c1b1",
    "editorError.foreground": "#b3361a",
    "scrollbarSlider.background": "#c9c1b166",
    "scrollbarSlider.hoverBackground": "#c9c1b199",
  },
});

export { monaco };
