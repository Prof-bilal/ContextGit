import type { HarnessLimits } from "../../lib/api";

export const usageKey = (value: HarnessLimits): string => `${value.harness}:${value.scope ?? "account"}:${value.session_id ?? ""}`;

/** Keep status-line account windows separate from the launch's token totals. */
export function mergeUsageReadings(current: HarnessLimits[], value: HarnessLimits): HarnessLimits[] {
  const previous = current.find(entry => usageKey(entry) === usageKey(value));
  if (previous?.launch_started_at && value.launch_started_at && previous.launch_started_at > value.launch_started_at) return current;
  const values: HarnessLimits[] = [];
  if (value.scope === "session" && value.windows.length) {
    values.push({ ...value, scope: "account", session_id: undefined, launch_id: undefined, launch_started_at: undefined, totals: null });
    value = { ...value, windows: [] };
  }
  values.push(value);
  const keys = new Set(values.map(usageKey));
  return [...current.filter(entry => !keys.has(usageKey(entry))), ...values];
}

export function displayedUsageReadings(readings: HarnessLimits[], sessionId?: string): HarnessLimits[] {
  const accounts = readings.filter(value => value.scope === "account" || !value.scope);
  const local = readings.filter(value => value.scope !== "account" && value.session_id === sessionId);
  return [...accounts, ...local.map(value => ({ ...value, account_reading: accounts.find(account => account.harness === value.harness) }))];
}
