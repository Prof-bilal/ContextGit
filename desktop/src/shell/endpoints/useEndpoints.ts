import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  type Confidence,
  type Endpoint,
  type EndpointGraph,
} from "@/lib/api";

export type ConfidenceFilter = "all" | Confidence;

export interface EndpointsState {
  projectPath: string | null;
  endpoints: Endpoint[];
  active: Endpoint | null;
  loading: boolean;
  error: string | null;
  scannedFiles: number;
  query: string;
  setQuery: (value: string) => void;
  confidence: ConfidenceFilter;
  setConfidence: (value: ConfidenceFilter) => void;
  select: (endpoint: Endpoint) => void;
  refresh: () => Promise<void>;
}

/** The endpoint graph of the active project, filtered for the rail. */
export function useEndpoints(projectPath: string | null): EndpointsState {
  const [graph, setGraph] = useState<EndpointGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confidence, setConfidence] = useState<ConfidenceFilter>("all");

  const load = useCallback(
    async (force: boolean) => {
      setLoading(true);
      try {
        const next = projectPath
          ? force
            ? await api.refreshEndpoints(projectPath)
            : await api.endpoints(projectPath)
          : await api.endpoints();
        setGraph(next);
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not scan the project",
        );
      } finally {
        setLoading(false);
      }
    },
    [projectPath],
  );

  useEffect(() => {
    setSelected(null);
    void load(false);
  }, [load]);

  const endpoints = useMemo(() => {
    const all = graph?.endpoints ?? [];
    const needle = query.trim().toLowerCase();
    return all.filter((endpoint) => {
      if (confidence !== "all" && endpoint.source.confidence !== confidence)
        return false;
      if (!needle) return true;
      return (
        endpoint.path.toLowerCase().includes(needle) ||
        endpoint.method.toLowerCase().includes(needle) ||
        (endpoint.operation ?? "").toLowerCase().includes(needle) ||
        (endpoint.source.file ?? "").toLowerCase().includes(needle)
      );
    });
  }, [graph, query, confidence]);

  const active = useMemo(
    () =>
      endpoints.find((endpoint) => endpoint.id === selected) ??
      endpoints[0] ??
      null,
    [endpoints, selected],
  );

  return {
    projectPath: graph?.project_path ?? projectPath,
    endpoints,
    active,
    loading,
    error,
    scannedFiles: graph?.scanned_files ?? 0,
    query,
    setQuery,
    confidence,
    setConfidence,
    select: (endpoint) => setSelected(endpoint.id),
    refresh: () => load(true),
  };
}
