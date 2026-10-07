import { useCallback, useEffect, useState } from "react";

import {
  api,
  emptyHttpRequest,
  type HttpCollection,
  type HttpHistoryEntry,
  type HttpRequestSpec,
  type HttpResponseResult,
} from "@/lib/api";

export interface ApiClientState {
  spec: HttpRequestSpec;
  patchSpec: (patch: Partial<HttpRequestSpec>) => void;
  response: HttpResponseResult | null;
  sending: boolean;
  error: string | null;
  collections: string[];
  history: HttpHistoryEntry[];
  activeCollection: string | null;
  send: () => Promise<void>;
  loadCollection: (name: string) => Promise<void>;
  saveCollection: (name: string) => Promise<void>;
  deleteCollection: (name: string) => Promise<void>;
  recall: (entry: HttpHistoryEntry) => void;
}

/** The API tab's state: one composed request, its response, collections and history. */
export function useApiClient(): ApiClientState {
  const [spec, setSpec] = useState<HttpRequestSpec>(emptyHttpRequest);
  const [response, setResponse] = useState<HttpResponseResult | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collections, setCollections] = useState<string[]>([]);
  const [history, setHistory] = useState<HttpHistoryEntry[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [names, entries] = await Promise.all([
        api.httpCollections(),
        api.httpHistory(50),
      ]);
      setCollections(names);
      setHistory(entries);
    } catch {
      // The rail stays empty until the local backend is up.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patchSpec = useCallback((patch: Partial<HttpRequestSpec>) => {
    setSpec((current) => ({ ...current, ...patch }));
  }, []);

  const send = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      setResponse(await api.httpRequest(spec));
    } catch (cause) {
      setResponse(null);
      setError(cause instanceof Error ? cause.message : "The request failed");
    } finally {
      setSending(false);
      void refresh();
    }
  }, [spec, refresh]);

  const loadCollection = useCallback(async (name: string) => {
    try {
      const collection = await api.httpCollection(name);
      setActiveCollection(name);
      const first = collection.requests[0];
      if (first) setSpec(first.spec);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open the collection",
      );
    }
  }, []);

  const saveCollection = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const existing: HttpCollection = collections.includes(trimmed)
          ? await api.httpCollection(trimmed)
          : { name: trimmed, requests: [] };
        const label = spec.url.trim() || `${spec.method} request`;
        const requests = [
          ...existing.requests.filter((entry) => entry.name !== label),
          { name: label, spec },
        ];
        await api.saveHttpCollection(trimmed, { name: trimmed, requests });
        setActiveCollection(trimmed);
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Could not save the request",
        );
      } finally {
        void refresh();
      }
    },
    [collections, spec, refresh],
  );

  const deleteCollection = useCallback(
    async (name: string) => {
      try {
        await api.deleteHttpCollection(name);
        setActiveCollection((current) => (current === name ? null : current));
        setError(null);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not delete the collection",
        );
      } finally {
        void refresh();
      }
    },
    [refresh],
  );

  const recall = useCallback((entry: HttpHistoryEntry) => {
    setSpec((current) => ({
      ...current,
      method: entry.method,
      url: entry.url,
    }));
  }, []);

  return {
    spec,
    patchSpec,
    response,
    sending,
    error,
    collections,
    history,
    activeCollection,
    send,
    loadCollection,
    saveCollection,
    deleteCollection,
    recall,
  };
}
