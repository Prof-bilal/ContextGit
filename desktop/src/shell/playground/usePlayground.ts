import { useEffect, useMemo, useState } from "react";
import { PLAYGROUND_ITEMS, type PlaygroundEvent, type PlaygroundInstalled, type PlaygroundPreview, type PlaygroundTrust } from "../../../shared/playground";

export type PlaygroundCategory = "featured" | "mcp" | "skill" | "tool" | "plugin" | "installed";
export function usePlayground(projectPath: string | null) {
  const [selectedId, setSelectedId] = useState("codeatlas");
  const [category, setCategory] = useState<PlaygroundCategory>("featured");
  const [query, setQuery] = useState("");
  const [trust, setTrust] = useState<PlaygroundTrust | "all">("all");
  const [installed, setInstalled] = useState<PlaygroundInstalled[]>([]);
  const [preview, setPreview] = useState<PlaygroundPreview | null>(null);
  const [progress, setProgress] = useState<PlaygroundEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bridge = window.contextgit;

  const refresh = async () => {
    if (bridge) setInstalled(await bridge.playgroundInstalled());
  };
  useEffect(() => {
    setPreview(null); setError(null); setProgress(null);
    try {
      const saved = JSON.parse(localStorage.getItem(`cg-playground:${projectPath}`) ?? "null") as { selectedId?: string; category?: PlaygroundCategory } | null;
      setSelectedId(saved?.selectedId ?? "codeatlas");
      setCategory(saved?.category && ["featured", "mcp", "skill", "tool", "plugin", "installed"].includes(saved.category) ? saved.category : "featured");
    } catch { setSelectedId("codeatlas"); setCategory("featured"); }
    void refresh().catch((cause: unknown) => setError(String(cause)));
    return bridge?.onPlaygroundProgress((event) => {
      setProgress(event);
      if (event.phase === "done") void refresh().catch((cause: unknown) => setError(String(cause)));
    });
  }, [projectPath, bridge]);
  const select = (id: string) => {
    setSelectedId(id); setPreview(null); setError(null);
    try { localStorage.setItem(`cg-playground:${projectPath}`, JSON.stringify({ selectedId: id, category })); } catch { /* storage unavailable */ }
  };
  const isInstalled = (id: string) => installed.some((entry) => entry.id === id && entry.projectPath === projectPath);
  const items = useMemo(() => PLAYGROUND_ITEMS.filter((item) => {
    const inCategory = category === "featured" ? item.featured : category === "installed"
      ? installed.some((entry) => entry.id === item.id && entry.projectPath === projectPath) : item.kind === category;
    return inCategory && (trust === "all" || trust === item.trust) && `${item.label} ${item.vendor} ${item.summary} ${item.capabilities.join(" ")}`.toLowerCase().includes(query.toLowerCase());
  }), [category, installed, projectPath, trust, query]);
  const active = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const review = async () => {
    if (!bridge || !active) return;
    setBusy(true); setError(null);
    try { setPreview(await bridge.playgroundPreview(active.id)); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const install = async () => {
    if (!bridge || !preview) return;
    setBusy(true); setError(null); setProgress(null);
    try { await bridge.playgroundInstall(preview.token); setPreview(null); await refresh(); }
    catch (cause) { setError(String(cause)); setPreview(null); }
    finally { setBusy(false); }
  };
  return { projectPath, active, items, category, setCategory, query, setQuery, trust, setTrust,
    isInstalled, select, preview, setPreview, review, install, busy, error, progress, bridge };
}
export type PlaygroundState = ReturnType<typeof usePlayground>;
