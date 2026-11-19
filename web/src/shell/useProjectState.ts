import { useCallback, useRef, useState, useSyncExternalStore, type SetStateAction } from "react";
import { projectRuntime } from "../../shared/projectRuntime";

/** Cache resource snapshots by project; async setters retain their owner. */
export function useProjectState<T>(initial: T | (() => T)) {
  const { path } = useSyncExternalStore(projectRuntime.subscribe, projectRuntime.read);
  const cache = useRef(new Map<string | null, T>());
  const [, render] = useState(0);
  if (!cache.current.has(path)) cache.current.set(path, typeof initial === "function" ? (initial as () => T)() : initial);
  const set = useCallback((value: SetStateAction<T>) => {
    const previous = cache.current.get(path) as T;
    cache.current.set(path, typeof value === "function" ? (value as (current: T) => T)(previous) : value);
    render(current => current + 1);
  }, [path]);
  return [cache.current.get(path) as T, set, path] as const;
}
