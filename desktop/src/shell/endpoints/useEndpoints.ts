import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  type Confidence,
  type Endpoint,
  type EndpointGraph,
  type EndpointTestFile,
  type EndpointTestSuite,
  type ServerStatus,
} from "@/lib/api";

export type ConfidenceFilter = "all" | Confidence;
export type Busy = "server" | "generate" | "run" | null;

export interface ProviderChoice {
  providerId: string;
  modelId: string;
}

export interface EndpointsState {
  projectPath: string | null;
  endpoints: Endpoint[];
  active: Endpoint | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  scannedFiles: number;
  query: string;
  setQuery: (value: string) => void;
  confidence: ConfidenceFilter;
  setConfidence: (value: ConfidenceFilter) => void;
  select: (endpoint: Endpoint) => void;
  refresh: () => Promise<void>;
  server: ServerStatus | null;
  suite: EndpointTestSuite | null;
  busy: Busy;
  hasProvider: boolean;
  testsFor: (endpoint: Endpoint) => EndpointTestFile | undefined;
  startServer: (command?: string) => Promise<void>;
  stopServer: () => Promise<void>;
  generate: (endpoint: Endpoint) => Promise<void>;
  runAll: () => Promise<void>;
}

/** The active project's endpoint graph, its server, and its generated tests. */
export function useEndpoints(
  projectPath: string | null,
  provider: ProviderChoice,
): EndpointsState {
  const [graph, setGraph] = useState<EndpointGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [confidence, setConfidence] = useState<ConfidenceFilter>("all");
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [suite, setSuite] = useState<EndpointTestSuite | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

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

  const loadServer = useCallback(async () => {
    try {
      setServer(await api.serveStatus(projectPath ?? undefined));
    } catch {
      // Nothing running is the normal state.
    }
  }, [projectPath]);

  const loadSuite = useCallback(async () => {
    if (!projectPath) return;
    try {
      setSuite(await api.endpointTests(projectPath));
    } catch {
      // A project without generated tests is the normal state.
    }
  }, [projectPath]);

  useEffect(() => {
    setSelected(null);
    void load(false);
    void loadServer();
    void loadSuite();
  }, [load, loadServer, loadSuite]);

  const startServer = useCallback(
    async (command?: string) => {
      if (!projectPath) return;
      setBusy("server");
      setNotice(null);
      try {
        setServer(await api.startServer(projectPath, command));
      } catch (cause) {
        setNotice(
          cause instanceof Error ? cause.message : "Could not start the server",
        );
      } finally {
        setBusy(null);
      }
    },
    [projectPath],
  );

  const stopServer = useCallback(async () => {
    setBusy("server");
    try {
      setServer(await api.stopServer());
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not stop the server",
      );
    } finally {
      setBusy(null);
    }
  }, []);

  const generate = useCallback(
    async (endpoint: Endpoint) => {
      if (!projectPath) return;
      setBusy("generate");
      setNotice(null);
      try {
        const result = await api.generateEndpointTests(
          projectPath,
          endpoint.id,
          provider.providerId,
          provider.modelId || undefined,
        );
        setSuite(result.suite);
        setNotice(
          result.failure
            ? `${result.file.file} was written but its tests still fail.`
            : `${result.overwrote ? "Rewrote" : "Wrote"} ${result.file.file}`,
        );
      } catch (cause) {
        setNotice(
          cause instanceof Error ? cause.message : "Could not generate tests",
        );
      } finally {
        setBusy(null);
      }
    },
    [projectPath, provider],
  );

  const runAll = useCallback(async () => {
    if (!projectPath) return;
    setBusy("run");
    setNotice(null);
    try {
      setSuite(await api.runEndpointTests(projectPath, server?.url ?? undefined));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Could not run the tests");
    } finally {
      setBusy(null);
    }
  }, [projectPath, server]);

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

  const testsFor = useCallback(
    (endpoint: Endpoint) =>
      suite?.files.find((file) => file.endpoint_id === endpoint.id),
    [suite],
  );

  return {
    projectPath: graph?.project_path ?? projectPath,
    endpoints,
    active,
    loading,
    error,
    notice,
    scannedFiles: graph?.scanned_files ?? 0,
    query,
    setQuery,
    confidence,
    setConfidence,
    select: (endpoint) => setSelected(endpoint.id),
    refresh: () => load(true),
    server,
    suite,
    busy,
    hasProvider: Boolean(provider.providerId),
    testsFor,
    startServer,
    stopServer,
    generate,
    runAll,
  };
}
