import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import type * as Monaco from "monaco-editor";
import { useShellTheme } from "./useShellTheme";

export interface CodeEditorHandle {
  /** Run the editor's registered document formatter, if it has one. */
  format: () => void;
  focus: () => void;
}

interface Props {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  /** Reports the editor's own diagnostics, so callers can surface them. */
  onMarkers?: (errors: number, warnings: number) => void;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number;
  wordWrap?: boolean;
}

const themeName = (theme: string) => (theme === "light" ? "cg-light" : "cg-dark");

/** A small, shell-themed Monaco instance. Monaco is code-split behind a dynamic
 *  import so it never rides in the main bundle; it loads the first time a body
 *  editor actually mounts. */
const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  {
    value,
    language,
    onChange,
    onMarkers,
    readOnly = false,
    placeholder,
    minHeight = 180,
    wordWrap = false,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const theme = useShellTheme();

  // Keep callbacks/options in refs so the create-once effect stays stable and
  // still reads the latest values once the async Monaco import resolves.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onMarkersRef = useRef(onMarkers);
  onMarkersRef.current = onMarkers;
  const latest = useRef({ value, language, readOnly, wordWrap, placeholder, theme });
  latest.current = { value, language, readOnly, wordWrap, placeholder, theme };

  useEffect(() => {
    let disposed = false;
    let contentSub: Monaco.IDisposable | undefined;
    let markerSub: Monaco.IDisposable | undefined;

    void import("./monacoSetup").then(({ monaco }) => {
      if (disposed || !hostRef.current) return;
      monacoRef.current = monaco;
      const init = latest.current;
      const editor = monaco.editor.create(hostRef.current, {
        value: init.value,
        language: init.language,
        theme: themeName(init.theme),
        readOnly: init.readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12.5,
        lineHeight: 20,
        fontFamily: '"Martian Mono", ui-monospace, monospace',
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: false,
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
        padding: { top: 10, bottom: 10 },
        tabSize: 2,
        wordWrap: init.wordWrap ? "on" : "off",
        placeholder: init.placeholder,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          useShadows: false,
        },
      });
      editorRef.current = editor;

      contentSub = editor.onDidChangeModelContent(() => {
        onChangeRef.current?.(editor.getValue());
      });

      markerSub = monaco.editor.onDidChangeMarkers(() => {
        const model = editor.getModel();
        if (!model || !onMarkersRef.current) return;
        const markers = monaco.editor.getModelMarkers({
          resource: model.uri,
        });
        onMarkersRef.current(
          markers.filter((m) => m.severity === monaco.MarkerSeverity.Error)
            .length,
          markers.filter((m) => m.severity === monaco.MarkerSeverity.Warning)
            .length,
        );
      });
    });

    return () => {
      disposed = true;
      contentSub?.dispose();
      markerSub?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model && model.getLanguageId() !== language) {
      monacoRef.current?.editor.setModelLanguage(model, language);
    }
  }, [language]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    monacoRef.current?.editor.setTheme(themeName(theme));
  }, [theme]);

  useImperativeHandle(ref, () => ({
    format: () => {
      void editorRef.current?.getAction("editor.action.formatDocument")?.run();
    },
    focus: () => editorRef.current?.focus(),
  }));

  return (
    <div
      className="cg-code"
      ref={hostRef}
      style={{ minHeight }}
      aria-label="Code editor"
    />
  );
});

export default CodeEditor;
