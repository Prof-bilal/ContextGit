import { useEffect, useMemo, useState } from "react";
import { LuFlame } from "react-icons/lu";

import { api, type ProviderInfo, type UsageSummary, type UsageSurface } from "@/lib/api";
import { agentLabel, agentMonogram } from "../agents";
import ActivityHeatmap, { type ActivityDay } from "../charts/ActivityHeatmap";
import { isReady } from "../chat/providerStatus";
import { AgentMark, Chip } from "../primitives";
import { brandFor } from "../providers";

/** Copy for the token-activity contribution graph. */
const activityCaption = (total: number) => `${total.toLocaleString()} tokens in the last year`;
const activityAria = (total: number) => `Token activity over the last year: ${total.toLocaleString()} tokens`;
const describeUsageDay = (day: ActivityDay, date: Date) =>
  `${day.count.toLocaleString()} tokens on ${date.toLocaleDateString()}`;

const SURFACE_LABEL: Record<UsageSurface, string> = {
  chat: "Chat",
  council: "Council",
  research: "Research",
  image: "Image",
  code: "Code",
};
const SURFACES: UsageSurface[] = ["chat", "council", "research", "image", "code"];

function fmt(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toLocaleString();
}

/** One row in the connected-AI table. */
interface AiUsage {
  id: string;
  label: string;
  /** true = an API provider (has a brand mark); false = a CLI harness. */
  provider: boolean;
  tokens: number;
  calls: number;
  estimated: number;
  models: string[];
}

/**
 * Merged token usage across every surface and every connected AI. Real tokens
 * come from the provider's usage frame; the rest (research, CLI/PTY turns,
 * providers that don't report) are estimated and tagged as such.
 */
export default function UsageView({
  days,
  providers,
}: {
  /** Undefined = all time; otherwise the last N days. */
  days: number | undefined;
  providers: ProviderInfo[];
}) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    void api
      .usage(days)
      .then((value) => {
        if (alive) setSummary(value);
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not load usage");
      });
    return () => {
      alive = false;
    };
  }, [days]);

  const rows = useMemo<AiUsage[]>(() => {
    const byId = new Map<string, AiUsage>();
    for (const row of summary?.by_provider ?? []) {
      const id = row.provider ?? "unknown";
      const entry =
        byId.get(id) ??
        { id, label: id, provider: false, tokens: 0, calls: 0, estimated: 0, models: [] };
      entry.tokens += row.totals.total_tokens;
      entry.calls += row.totals.calls;
      entry.estimated += row.totals.estimated_tokens;
      if (row.model && !entry.models.includes(row.model)) entry.models.push(row.model);
      byId.set(id, entry);
    }
    // Every connected provider appears, even with zero usage.
    for (const provider of providers) {
      if (!isReady(provider)) continue;
      const entry =
        byId.get(provider.id) ??
        { id: provider.id, label: provider.label, provider: true, tokens: 0, calls: 0, estimated: 0, models: [] };
      entry.label = provider.label;
      entry.provider = true;
      byId.set(provider.id, entry);
    }
    return [...byId.values()]
      .map((entry) => ({
        ...entry,
        label: entry.provider ? entry.label : agentLabel(entry.id),
      }))
      .sort((a, b) => b.tokens - a.tokens);
  }, [summary, providers]);

  const totals = summary?.totals;
  const daysList = summary?.by_day ?? [];
  const streak = summary?.streak;
  const activityDays = useMemo<ActivityDay[]>(
    () =>
      (summary?.activity ?? []).map((day) => ({ date: day.date, count: day.totals.total_tokens })),
    [summary],
  );
  const avgPerDay = daysList.length && totals ? Math.round(totals.total_tokens / daysList.length) : 0;

  const surfaceRows = useMemo(() => {
    const bySurface = new Map((summary?.by_surface ?? []).map((row) => [row.surface, row.totals]));
    return SURFACES.map((surface) => ({ surface, totals: bySurface.get(surface) })).filter(
      (entry) => entry.totals,
    );
  }, [summary]);

  return (
    <div className="cg-usage">
      <div className="cg-view-toolbar">
        <h1>Usage</h1>
        <span className="cg-view-sub">
          {days === undefined ? "All time" : days === 1 ? "Today" : `Last ${days} days`}
        </span>
        <span className="cg-toolbar-spacer" />
        {totals && totals.estimated_tokens > 0 && (
          <Chip tone="warn">{fmt(totals.estimated_tokens)} estimated</Chip>
        )}
      </div>

      {error && <p className="cg-pane-error">{error}</p>}

      {totals && totals.calls === 0 && (
        <p className="cg-empty-note">
          No usage yet. Send a chat message, run a council/research, or commit a Code checkpoint —
          token usage from every connected AI shows up here.
        </p>
      )}

      {totals && totals.calls > 0 && streak && (
        <>
          <section
            className="cg-usage-streak"
            data-active={streak.current > 0}
            aria-label="Activity streak"
          >
            <div className="cg-usage-streak-hero">
              <LuFlame className="cg-usage-streak-flame" aria-hidden="true" />
              <div className="cg-usage-streak-count">
                <span className="cg-kicker">Current streak</span>
                <strong>{streak.current}</strong>
                <span className="cg-view-sub">
                  {streak.current === 1 ? "day" : "days"} in a row
                </span>
              </div>
            </div>
            <div className="cg-usage-streak-stats">
              <div>
                <span className="cg-kicker">Best streak</span>
                <strong>{streak.longest}</strong>
              </div>
              <div>
                <span className="cg-kicker">Active days</span>
                <strong>{streak.active_days}</strong>
              </div>
            </div>
            {streak.current === 0 && (
              <p className="cg-view-sub">
                Start a streak today — any chat, council, research or Code commit counts.
              </p>
            )}
          </section>

          <section className="cg-usage-cards" aria-label="Totals">
            <div className="cg-usage-card">
              <span className="cg-kicker">Total tokens</span>
              <strong>{totals.total_tokens.toLocaleString()}</strong>
              <span className="cg-view-sub">
                {fmt(totals.prompt_tokens)} prompt · {fmt(totals.completion_tokens)} completion
              </span>
            </div>
            <div className="cg-usage-card">
              <span className="cg-kicker">Model calls</span>
              <strong>{totals.calls.toLocaleString()}</strong>
              <span className="cg-view-sub">
                {totals.total_tokens - totals.estimated_tokens > 0
                  ? `${fmt(totals.total_tokens - totals.estimated_tokens)} real`
                  : "all estimated"}
              </span>
            </div>
            <div className="cg-usage-card">
              <span className="cg-kicker">Days active</span>
              <strong>{daysList.length.toLocaleString()}</strong>
              <span className="cg-view-sub">
                {daysList.length === 1 ? "day" : "days"} with usage
              </span>
            </div>
            <div className="cg-usage-card" data-accent="true">
              <span className="cg-kicker">Avg / day</span>
              <strong>{avgPerDay.toLocaleString()}</strong>
              <span className="cg-view-sub">tokens per active day</span>
            </div>
          </section>

          {activityDays.length > 0 && (
            <section className="cg-usage-section" aria-label="Activity">
              <ActivityHeatmap
                days={activityDays}
                caption={activityCaption}
                ariaLabel={activityAria}
                describe={describeUsageDay}
              />
            </section>
          )}

          <section className="cg-usage-section" aria-label="Connected AI">
            <h3 className="cg-kicker">Connected AI</h3>
            <ul className="cg-usage-list">
              {rows.map((row) => {
                const brand = row.provider ? brandFor(row.id, row.label) : null;
                return (
                  <li key={row.id} className="cg-usage-row">
                    {brand ? (
                      <AgentMark agent={brand.hue} icon={brand.icon} label={brand.monogram} />
                    ) : (
                      <AgentMark agent={row.id} label={agentMonogram(row.id)} />
                    )}
                    <span className="cg-usage-name">
                      {row.label}
                      {row.models.length > 0 && (
                        <span className="cg-view-sub"> · {row.models.slice(0, 2).join(" · ")}</span>
                      )}
                    </span>
                    <span className="cg-toolbar-spacer" />
                    {row.estimated > 0 && (
                      <Chip tone={row.estimated === row.tokens ? "warn" : undefined}>
                        {row.estimated === row.tokens ? "est" : "mixed"}
                      </Chip>
                    )}
                    <span className="cg-usage-calls">{row.calls} calls</span>
                    <span className="cg-usage-tokens">{row.tokens.toLocaleString()} tok</span>
                  </li>
                );
              })}
              {rows.length === 0 && <li className="cg-empty-note">No connected AI yet.</li>}
            </ul>
          </section>

          {surfaceRows.length > 0 && (
            <section className="cg-usage-section" aria-label="By surface">
              <h3 className="cg-kicker">By surface</h3>
              <ul className="cg-usage-list">
                {surfaceRows.map(({ surface, totals: surfaceTotals }) => (
                  <li key={surface} className="cg-usage-row">
                    <span className="cg-usage-name">{SURFACE_LABEL[surface]}</span>
                    <span className="cg-toolbar-spacer" />
                    <span className="cg-usage-calls">{surfaceTotals?.calls ?? 0} calls</span>
                    <span className="cg-usage-tokens">
                      {(surfaceTotals?.total_tokens ?? 0).toLocaleString()} tok
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
