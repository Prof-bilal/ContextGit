import { useCallback, useEffect, useState } from "react";

import {
  api,
  type ProviderInfo,
  type ProviderInput,
  type ProviderModelsResult,
  type ProviderTestResult,
} from "@/lib/api";

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * The provider registry the Chat tab configures: list, add/remove, and the two
 * verification calls (test connection, fetch models) from the add-a-provider flow.
 */
export function useProviders() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setProviders(await api.providers());
      setError(null);
    } catch (cause) {
      setError(message(cause, "Could not load providers"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (input: ProviderInput): Promise<ProviderInfo> => {
      const provider = await api.addProvider(input);
      await refresh();
      return provider;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      await api.deleteProvider(id);
      await refresh();
    },
    [refresh],
  );

  const test = useCallback(
    (id: string): Promise<ProviderTestResult> => api.testProvider(id),
    [],
  );

  const fetchModels = useCallback(
    async (id: string): Promise<ProviderModelsResult> => {
      const result = await api.fetchProviderModels(id);
      await refresh();
      return result;
    },
    [refresh],
  );

  return { providers, error, loading, refresh, add, remove, test, fetchModels };
}
