import { useCallback, useRef, useState, type SetStateAction } from "react";

/** Panel preferences follow their project; async callbacks retain the original owner. */
export function useCanvasPreference<T>(
  path: string | undefined,
  key: string,
  initial: T,
) {
  const values = useRef(new Map<string, T>());
  const [, update] = useState(0);
  const owner = `${path ?? "none"}:${key}`;
  if (!values.current.has(owner)) {
    let value = initial;
    try {
      const saved = localStorage.getItem(`contextgit:canvas:${owner}`);
      if (saved !== null) value = JSON.parse(saved) as T;
    } catch {
      /* use default */
    }
    values.current.set(owner, value);
  }
  const set = useCallback(
    (next: SetStateAction<T>) => {
      const previous = values.current.get(owner) as T;
      const value =
        typeof next === "function"
          ? (next as (previous: T) => T)(previous)
          : next;
      values.current.set(owner, value);
      try {
        localStorage.setItem(
          `contextgit:canvas:${owner}`,
          JSON.stringify(value),
        );
      } catch {
        /* full storage does not block the canvas */
      }
      update((current) => current + 1);
    },
    [owner],
  );
  return [values.current.get(owner) as T, set] as const;
}
