import type { HarnessLimits, LimitWindow, LimitTotals } from "../../lib/api";
import { HARNESS_BY_ID } from "../shared/harnesses";

export function emptyUsage(harness: string, message: string, state: HarnessLimits["state"] = "unsupported"): HarnessLimits {
  return { harness, label: HARNESS_BY_ID[harness]?.label ?? harness, supported: state !== "unsupported", signed_in: false,
    source: null, plan: null, windows: [], credits: null, totals: null, message,
    state, fetched_at: new Date().toISOString(), scope: "account" };
}
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const record = (value: unknown): Record<string, any> => value && typeof value === "object" ? value as Record<string, any> : {};
const iso = (seconds: unknown): string | null => numeric(seconds) && seconds < 8.64e12 ? new Date(seconds * 1000).toISOString() : null;

export function codexLimits(payload: unknown, account: unknown): HarnessLimits {
  const result = emptyUsage("codex", "No account quota was returned.", "waiting");
  const auth = record(record(account).account);
  if (!auth.type) return emptyUsage("codex", "Sign in to Codex to see account limits.", "not_signed_in");
  if (auth.type === "apiKey" || auth.type === "amazonBedrock") return emptyUsage("codex", "This authentication mode does not expose ChatGPT account quotas.");
  result.plan = typeof auth.planType === "string" ? auth.planType : null;
  result.signed_in = true;
  result.source = "Codex app-server";
  const data = record(payload);
  const buckets = data.rateLimitsByLimitId ? Object.entries(record(data.rateLimitsByLimitId)) : [["codex", data.rateLimits]];
  for (const [id, raw] of buckets) {
    const bucket = record(raw);
    for (const key of ["primary", "secondary"]) {
      const window = record(bucket[key]);
      if (!numeric(window.usedPercent)) continue;
      const duration = window.windowDurationMins;
      const label = duration === 10080 ? "Weekly" : numeric(duration) ? (duration % 60 === 0 ? `${duration / 60}-hour` : `${duration}-minute`) : key;
      result.windows.push({ label: `${bucket.limitName || id} · ${label}`, used: window.usedPercent, cap: 100, unit: "%", reset_at: iso(window.resetsAt) });
    }
    const credits = record(bucket.credits);
    const balance = typeof credits.balance === "string" ? Number(credits.balance) : credits.balance;
    if (numeric(balance)) result.credits = { total_remaining: balance, monthly_remaining: null, purchased_remaining: null, free_remaining: null, wallet_remaining: null, total_spent: null };
  }
  if (result.windows.length || result.credits) { result.state = "available"; result.message = null; }
  return result;
}

export function claudeUsage(payload: unknown): { windows: LimitWindow[]; totals: LimitTotals | null } {
  const data = record(payload);
  const windows: LimitWindow[] = [];
  for (const [id, label] of [["five_hour", "5-hour"], ["seven_day", "Weekly"], ["spend_limit", "Spend limit"]]) {
    const window = record(record(data.rate_limits)[id]);
    if (numeric(window.used_percentage)) windows.push({ label, used: window.used_percentage, cap: 100, unit: "%", reset_at: iso(window.resets_at) });
  }
  const cost = record(data.cost).total_cost_usd;
  return { windows, totals: numeric(cost) ? { total_cost: cost, total_tokens: null, requests: null, period: "session" } : null };
}

/** JSON objects may be pretty printed and split across arbitrary file reads. */
export function jsonRecords(input: string): { records: unknown[]; remaining: string } {
  const records: unknown[] = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (start < 0) { if (char !== "{") continue; start = index; depth = 1; continue; }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      try { records.push(JSON.parse(input.slice(start, index + 1))); } catch { /* malformed record */ }
      start = -1;
    }
  }
  return { records, remaining: start < 0 ? "" : input.slice(start) };
}

/** OTel's file exporter reports cumulative counters: replace each series. */
export function geminiCounters(payload: unknown, counters: Map<string, number>): LimitTotals | null {
  const data = record(payload);
  for (const scope of data.scopeMetrics ?? []) for (const metric of scope.metrics ?? []) {
    const name = metric.descriptor?.name;
    if (name !== "gemini_cli.token.usage" && name !== "gemini_cli.api.request.count") continue;
    for (const point of metric.dataPoints ?? []) {
      if (!numeric(point.value)) continue;
      const attributes = record(point.attributes);
      const key = `${name}:${JSON.stringify(Object.entries(attributes).sort())}`;
      counters.set(key, point.value);
    }
  }
  if (!counters.size) return null;
  let tokens = 0, requests = 0;
  for (const [key, value] of counters) {
    if (key.startsWith("gemini_cli.token.usage:")) tokens += value;
    else requests += value;
  }
  return { total_tokens: tokens, total_cost: null, requests, period: "session" };
}

const amount = (text: string): number => {
  const match = text.replaceAll(",", "").match(/([\d.]+)\s*([kmb])?/i);
  return match ? Number(match[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase()] ?? 1) : NaN;
};
export function stripAnsi(text: string): string { return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""); }
export function statsTotals(text: string): LimitTotals | null {
  const clean = stripAnsi(text);
  const cost = clean.match(/(?:total\s+)?cost\s*[:│|]?\s*\$\s*([\d.,]+)/i);
  const tokens = clean.match(/(?:total\s+)?tokens\s*[:│|]?\s*([\d.,]+\s*[kmb]?)/i);
  if (!cost && !tokens) return null;
  return { total_tokens: tokens ? amount(tokens[1]) : null, total_cost: cost ? amount(cost[1]) : null, requests: null, period: "all time · local project" };
}
export function aiderReport(line: string): { tokens: number | null; cost: number | null } | null {
  const clean = stripAnsi(line);
  const tokens = clean.match(/Tokens:\s*([\d.,]+\s*[kmb]?)\s+sent,\s*([\d.,]+\s*[kmb]?)\s+received/i);
  const cost = clean.match(/\$([\d.]+)\s+session\./i);
  if (!tokens && !cost) return null;
  return { tokens: tokens ? amount(tokens[1]) + amount(tokens[2]) : null, cost: cost ? Number(cost[1]) : null };
}
