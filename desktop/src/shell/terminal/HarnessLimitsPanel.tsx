import { useEffect, useState } from "react";
import { LuRefreshCw } from "react-icons/lu";

import type { HarnessLimits, LimitWindow } from "@/lib/api";
import { agentLabel, agentMonogram } from "../agents";
import { AgentMark, Chip, IconButton } from "../primitives";

/** 1351057602 -> "1.35B". */
function compact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/** "2026-10-06T08:09:36Z" -> "resets in 3h 20m". */
function resetIn(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "resetting…";
  const minutes = Math.round(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function WindowMeter({ window }: { window: LimitWindow }) {
  const ratio = window.cap > 0 ? Math.max(0, Math.min(1, window.used / window.cap)) : 0;
  return (
    <div className="cg-limit">
      <div className="cg-limit-head">
        <span className="cg-limit-label">{window.label}</span>
        <span className="cg-view-sub">
          {window.unit === "%" ? `${compact(window.used)}% used` : `${compact(window.used)} / ${compact(window.cap)} ${window.unit}`}
        </span>
      </div>
      <div className="cg-burn-bar" data-tone={ratio > 0.85 ? "bad" : ratio > 0.6 ? "warn" : undefined}>
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className="cg-limit-foot">
        <span className="cg-view-sub">{(ratio * 100).toFixed(0)}% used</span>
        {window.reset_at && <span className="cg-view-sub">resets in {resetIn(window.reset_at)}</span>}
      </div>
    </div>
  );
}

/**
 * The Limits section of the Code dock: what a CLI harness reports about its own
 * account (Command Code's 5-hour/weekly windows and credits, Cline's plan, …).
 * Every state is soft — unsupported, not signed in, or an error all read as a
 * quiet line, never a broken panel.
 */
export default function HarnessLimitsPanel({
  harness,
  limits,
  loading,
  onRefresh,
}: {
  harness: string;
  limits: HarnessLimits | undefined;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer); }, []);
  const aged = !!limits && Date.now() - new Date(limits.fetched_at).getTime() > (limits.scope === "account" ? 360_000 : 90_000);
  const label = limits?.label ?? agentLabel(harness);
  return (
    <section className="cg-limits" aria-label={`${label} limits`}>
      <header className="cg-block-head">
        <AgentMark agent={harness} label={agentMonogram(harness)} />
        <span className="cg-kicker">{limits?.scope === "session" ? "Session usage" : limits?.scope === "local_project" ? "Project usage" : "Usage & limits"}</span>
        {limits?.plan && <Chip>{limits.plan}</Chip>}
        <span className="cg-toolbar-spacer" />
        <IconButton label="Refresh limits" pressed={loading} onClick={onRefresh}>
          <LuRefreshCw aria-hidden="true" />
        </IconButton>
      </header>

      {limits?.account_reading && <HarnessLimitsPanel harness={harness} limits={limits.account_reading} loading={loading} onRefresh={onRefresh} />}

      {!limits && (
        <p className="cg-empty-note">
          {loading ? "Loading limits…" : "No usage limits reported by this harness."}
        </p>
      )}

      {(limits?.stale || aged) && <p className="cg-view-sub" role="status">Last reading · refresh unavailable</p>}
      {loading && <p className="cg-view-sub" role="status">Refreshing…</p>}
      {limits?.source && <p className="cg-view-sub">{limits.source} · {new Date(limits.fetched_at).toLocaleTimeString()}</p>}
      {harness === "ollama" && <p className="cg-view-sub"><a href="https://ollama.com/usage" target="_blank" rel="noreferrer">Open Ollama cloud usage</a></p>}
      {limits && !limits.signed_in && limits.state !== "available" && (
        <p className="cg-empty-note">{limits.message ?? `Sign in to ${label} to see limits.`}</p>
      )}

      {(limits?.signed_in || limits?.state === "available") && limits && (
        <>
          {limits.windows.length > 0 && <p className="cg-kicker">Account limits</p>}
          {limits.windows.map((window) => (
            <WindowMeter key={window.label} window={window} />
          ))}

          {limits.credits && limits.credits.total_remaining !== null && (
            <dl className="cg-limit-credits">
              <div>
                <dt>Remaining</dt>
                <dd>{compact(limits.credits.total_remaining)}</dd>
              </div>
              {limits.credits.wallet_remaining !== null && (
                <div>
                  <dt>Wallet</dt>
                  <dd>{compact(limits.credits.wallet_remaining)}</dd>
                </div>
              )}
              {limits.credits.monthly_remaining !== null && (
                <div>
                  <dt>Monthly</dt>
                  <dd>{compact(limits.credits.monthly_remaining)}</dd>
                </div>
              )}
              {limits.credits.total_spent !== null && (
                <div>
                  <dt>Spent</dt>
                  <dd>${limits.credits.total_spent.toFixed(2)}</dd>
                </div>
              )}
            </dl>
          )}

          {limits.totals && <p className="cg-kicker">{limits.scope === "local_project" ? "Local project usage" : limits.scope === "session" ? "Session usage" : "Account usage"}</p>}
          {limits.totals && (
            <p className="cg-view-sub">
              {limits.totals.total_tokens !== null && `${compact(limits.totals.total_tokens)} tokens` }
              {limits.totals.total_cost !== null && `${limits.totals.total_tokens !== null ? " · " : ""}$${limits.totals.total_cost.toFixed(2)}`}
              {limits.totals.requests !== null && ` · ${compact(limits.totals.requests)} calls`}
              {limits.totals.period ? ` · ${limits.totals.period}` : ""}
            </p>
          )}

          {limits.message && <p className="cg-view-sub">{limits.message}</p>}
        </>
      )}
    </section>
  );
}
