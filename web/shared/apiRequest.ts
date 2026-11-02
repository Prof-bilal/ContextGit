export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly kind?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOptions extends RequestInit { timeoutMs?: number }

function currentBackendUrl(url: string): string {
  const bridge = typeof window !== "undefined" ? window.contextgit : undefined;
  const base = bridge?.getStatus?.().apiBase;
  if (!base) return url;
  try {
    const target = new URL(url);
    const replacement = new URL(base);
    target.protocol = replacement.protocol;
    target.host = replacement.host;
    return target.toString();
  } catch {
    return url;
  }
}

async function waitForBackend(cancellation: Promise<never>): Promise<string | null> {
  const bridge = typeof window !== "undefined" ? window.contextgit : undefined;
  if (!bridge) return null;
  try {
    // A mutation may be the first request after a project switch or a browser
    // backend restart. Ask the native supervisor for the address again before
    // relying on the renderer's one-second status poll.
    await Promise.race([bridge.refreshBackendStatus(), cancellation]);
  } catch {
    // Continue with the normal bounded polling below.
  }
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const status = bridge.getStatus?.();
    if (status?.status.state === "ready" && status.apiBase) return status.apiBase;
    await Promise.race([
      new Promise<void>((resolve) => setTimeout(resolve, 250)),
      cancellation,
    ]);
  }
  return null;
}

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
  const operation = async (targetUrl: string) => {
    const response = await fetcher(targetUrl, { ...init, signal: controller.signal });
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let body: unknown = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* plain-text error body */ }
      const record = typeof body === "object" && body !== null ? body as Record<string, unknown> : {};
      const detail = typeof record.detail === "object" && record.detail !== null
        ? record.detail as Record<string, unknown> : {};
      const message = String(record.error ?? detail.message ?? (typeof record.detail === "string" ? record.detail : raw || `API request failed (${response.status})`));
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
    try {
      return await Promise.race([operation(url), cancellation]);
    } catch (cause) {
      // Startup and project switching can invalidate the selected port between
      // requests. Wait for the browser bridge to publish the new healthy address,
      // then retry this idempotent/read or mutation request once. This keeps a
      // transient restart from becoming a permanent "backend unreachable"
      // banner in the workbench.
      if (cause instanceof ApiError || timedOut || cancelled || !["GET", "HEAD"].includes(init.method ?? "GET")) throw cause;
      const base = await waitForBackend(cancellation);
      if (!base) throw cause;
      return await Promise.race([operation(currentBackendUrl(url)), cancellation]);
    }
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    if (timedOut) throw new ApiError("The backend took too long to respond. Refresh before retrying; the operation may have completed.", 0, "timeout");
    if (cancelled) throw new ApiError("Request cancelled.", 0, "cancelled");
    const mutation = !["GET", "HEAD"].includes(init.method ?? "GET");
    throw new ApiError(mutation
      ? "The request could not be confirmed. It may have completed; refresh this project before trying again."
      : "Cannot reach the local backend. Check the connection banner and retry.", 0, "network");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) callerSignal?.removeEventListener("abort", onAbort);
  }
}
