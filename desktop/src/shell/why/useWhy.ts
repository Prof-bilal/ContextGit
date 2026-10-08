import { useCallback, useEffect, useState } from "react";

import { api, type WhyAnswer, type WhyFinding } from "@/lib/api";

export interface ProviderChoice {
  providerId: string;
  modelId: string;
}

export interface WhyRequest {
  path: string;
  line: number | null;
  nonce: number;
}

export interface WhyState {
  path: string;
  setPath: (value: string) => void;
  line: string;
  setLine: (value: string) => void;
  asOf: string | null;
  answer: WhyAnswer | null;
  history: WhyFinding[];
  loading: boolean;
  error: string | null;
  hasProvider: boolean;
  explain: (asOf?: string | null) => Promise<void>;
  select: (finding: WhyFinding) => void;
}

/** The Why lens: read the reasoning behind a file, as of any point in its history. */
export function useWhy(
  projectPath: string | null,
  provider: ProviderChoice,
  request: WhyRequest | null,
): WhyState {
  const [path, setPath] = useState("");
  const [line, setLine] = useState("");
  const [asOf, setAsOf] = useState<string | null>(null);
  const [answer, setAnswer] = useState<WhyAnswer | null>(null);
  const [history, setHistory] = useState<WhyFinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explain = useCallback(
    async (at?: string | null) => {
      if (!projectPath || !path.trim()) return;
      const when = at === undefined ? asOf : at;
      setAsOf(when ?? null);
      setLoading(true);
      try {
        const parsed = Number.parseInt(line, 10);
        const found = await api.why({
          projectPath,
          path: path.trim(),
          line: Number.isFinite(parsed) ? parsed : null,
          asOf: when ?? null,
          providerId: provider.providerId || undefined,
        });
        setAnswer(found);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not explain this path");
      } finally {
        setLoading(false);
      }
    },
    [projectPath, path, line, asOf, provider.providerId],
  );

  // The timeline is cheap (no LLM), so it loads whenever the path changes.
  useEffect(() => {
    if (!projectPath || !path.trim()) {
      setHistory([]);
      return;
    }
    let live = true;
    void api
      .whyHistory(projectPath, path.trim())
      .then((found) => {
        if (live) setHistory(found);
      })
      .catch(() => {
        if (live) setHistory([]);
      });
    return () => {
      live = false;
    };
  }, [projectPath, path]);

  // A request from another tab (the endpoint "Why?" button) wins.
  useEffect(() => {
    if (!request) return;
    setPath(request.path);
    setLine(request.line ? String(request.line) : "");
    setAsOf(null);
  }, [request]);

  const select = useCallback(
    (finding: WhyFinding) => {
      void explain(finding.code_commit ?? null);
    },
    [explain],
  );

  return {
    path,
    setPath,
    line,
    setLine,
    asOf,
    answer,
    history,
    loading,
    error,
    hasProvider: Boolean(provider.providerId),
    explain,
    select,
  };
}
