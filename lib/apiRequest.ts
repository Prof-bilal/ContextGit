export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly kind?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions extends RequestInit { timeoutMs?: number }

/** Only bound ordinary workbench operations; inference and long jobs keep their budgets. */
export function requestTimeout(path: string, method = "GET"): number | undefined {
  const route = path.split("?")[0];
  if (method === "GET" && /^\/api\/v1\/(sessions(?:\/[^/]+(?:\/(?:workspace|staging|capture))?)?|commits\/[^/]+\/conversation(?:\/page)?|fleet|team|merge-queue|trash|integration\/(?:jobs|settings)|repo|branches(?:\/[^/]+\/budget)?)$/.test(route)) return 10_000;
  if (/^\/api\/v1\/(sessions(?:\/[^/]+(?:\/(?:staging|commit|restore|capture))?)?|branches(?:\/restore)?)$/.test(route)) return 30_000;
  return undefined;
}

/** The deadline covers headers AND the body, and is always cleared after completion. */
export async function apiRequest<T>(url: string, options: RequestOptions = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const { timeoutMs, signal: callerSignal, ...init } = options;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let timedOut = false;
  const operation = async () => {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
      const detail = typeof record.detail === "object" && record.detail !== null
        ? record.detail as Record<string, unknown> : {};
      const message = String(record.error ?? detail.message ?? (typeof record.detail === "string" ? record.detail : `API request failed (${response.status})`));
      const kind = record.type !== undefined ? String(record.type) : detail.status !== undefined ? String(detail.status) : undefined;
      throw new ApiError(message, response.status, kind);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  };
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    onAbort = () => {
      cancelled = true;
      reject(new ApiError("Request cancelled.", 0, "cancelled"));
      controller.abort(callerSignal?.reason);
    };
    if (callerSignal?.aborted) onAbort();
    else callerSignal?.addEventListener("abort", onAbort, { once: true });
    if (timeoutMs !== undefined && !cancelled) timer = setTimeout(() => {
      timedOut = true;
      reject(new ApiError("The backend took too long to respond. Check the connection banner and refresh before retrying; the operation may have completed.", 0, "timeout"));
      controller.abort();
    }, timeoutMs);
  });
  try {
    if (cancelled) return await cancellation;
    return await Promise.race([operation(), cancellation]);
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    if (timedOut) throw new ApiError("The backend took too long to respond. Refresh before retrying; the operation may have completed.", 0, "timeout");
    if (cancelled) throw new ApiError("Request cancelled.", 0, "cancelled");
    throw new ApiError("Cannot reach the local backend. Check the connection banner and retry.", 0, "network");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) callerSignal?.removeEventListener("abort", onAbort);
  }
}
