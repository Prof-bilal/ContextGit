export type ProjectHandle = { projectId: string; repoId: string; path: string };
type ProjectState = { path: string | null; ready: boolean; error: string | null; revision: number };
let state: ProjectState = { path: null, ready: false, error: null, revision: 0 };
const listeners = new Set<() => void>();
const handles = new Map<string, Promise<ProjectHandle>>();
const prepared = new Set<string>();
export const projectRuntime = {
  read: () => state,
  subscribe: (callback: () => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  select(path: string | null) {
    // Revalidate cached registrations on a visit: the server may have evicted
    // an idle project, while its cached renderer view remains usable.
    if (path) handles.delete(path);
    state = { path, ready: path !== null && prepared.has(path), error: null, revision: state.revision + 1 };
    listeners.forEach(callback => callback());
    if (path) void prepareProject(path).catch(() => {});
  },
};

export function prepareProject(path: string): Promise<ProjectHandle> {
  const cached = handles.get(path);
  if (cached) return cached;
  let opening!: Promise<ProjectHandle>;
  opening = (async () => {
    const bridge = window.contextgit!;
    const backend = await bridge.refreshBackendStatus();
    if (backend.status.state !== "ready") throw new Error("The local backend is unavailable.");
    const response = await fetch(`${backend.apiBase}/api/v1/projects/open`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bridge.apiToken}` },
      body: JSON.stringify({ path }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail ?? body.error ?? "Could not open this project.");
    }
    const handle = await response.json() as ProjectHandle;
    prepared.add(path);
    if (state.path === path && handles.get(path) === opening) {
      state = { ...state, ready: true, error: null, revision: state.revision + 1 };
      listeners.forEach(callback => callback());
    }
    return handle;
  })().catch(cause => {
    if (handles.get(path) === opening) handles.delete(path);
    if (state.path === path && !handles.has(path)) {
      state = { ...state, ready: false, error: cause instanceof Error ? cause.message : String(cause), revision: state.revision + 1 };
      listeners.forEach(callback => callback());
    }
    throw cause;
  });
  handles.set(path, opening);
  return opening;
}

export function invalidateProjects() { handles.clear(); prepared.clear(); projectRuntime.select(state.path); }
