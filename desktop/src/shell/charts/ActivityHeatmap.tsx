import { useMemo } from "react";

const CELL = 13;
const GAP = 3;
const STEP = CELL + GAP;
const GUTTER_LEFT = 30;
const GUTTER_TOP = 18;
const DAY = 24 * 60 * 60 * 1000;
const DAYS_SHOWN = 365;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One day of activity: an ISO date (YYYY-MM-DD, UTC) and its magnitude. */
export interface ActivityDay {
  date: string;
  count: number;
}

/** UTC day key for a date ("YYYY-MM-DD"). */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Bucket a day's magnitude into 0–4 so a busy history still reads at a glance. */
function levelFor(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/**
 * A GitHub-style contribution grid: a year of weeks (columns) × days (rows),
 * with month labels across the top, weekday labels down the left and a
 * Less→More legend. Callers supply the daily series plus the copy: `caption`
 * and `ariaLabel` receive the series total, `describe` writes each cell's
 * tooltip. Days are UTC, so cells never shift with the viewer's timezone.
 */
export default function ActivityHeatmap({
  days,
  caption,
  ariaLabel,
  describe,
}: {
  days: ActivityDay[];
  caption: (total: number) => string;
  ariaLabel: (total: number) => string;
  describe: (day: ActivityDay, date: Date) => string;
}) {
  const { cells, total, width, height, months } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const day of days) counts.set(day.date, (counts.get(day.date) ?? 0) + day.count);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today.getTime() - (DAYS_SHOWN - 1) * DAY);
    start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // walk back to the week's Sunday

    const columns = Math.floor((today.getTime() - start.getTime()) / DAY / 7) + 1;
    const max = Math.max(0, ...counts.values());

    const cells: Array<{ key: string; x: number; y: number; level: number; label: string }> = [];
    let total = 0;

    for (let column = 0; column < columns; column += 1) {
      for (let row = 0; row < 7; row += 1) {
        const date = new Date(start.getTime() + (column * 7 + row) * DAY);
        if (date.getTime() > today.getTime()) continue; // no future cells
        const key = dayKey(date);
        const count = counts.get(key) ?? 0;
        total += count;
        cells.push({
          key,
          x: GUTTER_LEFT + column * STEP,
          y: GUTTER_TOP + row * STEP,
          level: levelFor(count, max),
          label: describe({ date: key, count }, date),
        });
      }
    }

    // A month label on the first column whose week starts in a new month.
    const months: Array<{ x: number; label: string }> = [];
    let lastMonth = -1;
    for (let column = 0; column < columns; column += 1) {
      const first = new Date(start.getTime() + column * 7 * DAY);
      if (first.getTime() > today.getTime()) break;
      if (first.getUTCMonth() === lastMonth) continue;
      lastMonth = first.getUTCMonth();
      months.push({ x: GUTTER_LEFT + column * STEP, label: MONTHS[first.getUTCMonth()] });
    }

    return {
      cells,
      total,
      width: GUTTER_LEFT + columns * STEP,
      height: GUTTER_TOP + 7 * STEP,
      months,
    };
  }, [days, describe]);

  return (
    <div className="cg-heat">
      <div className="cg-heat-head">
        <span className="cg-view-sub">{caption(total)}</span>
        <span className="cg-heat-legend" aria-hidden="true">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className="cg-heat-swatch" data-level={level} />
          ))}
          <span>More</span>
        </span>
      </div>
      <div className="cg-heat-scroll">
        <svg
          className="cg-heat-grid"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel(total)}
        >
          {months.map((month) => (
            <text
              key={`${month.x}-${month.label}`}
              className="cg-heat-axis"
              x={month.x}
              y={GUTTER_TOP - 6}
            >
              {month.label}
            </text>
          ))}
          {[1, 3, 5].map((row) => (
            <text
              key={row}
              className="cg-heat-axis"
              x={GUTTER_LEFT - 6}
              y={GUTTER_TOP + row * STEP + CELL - 3}
              textAnchor="end"
            >
              {WEEKDAYS[row]}
            </text>
          ))}
          {cells.map((cell) => (
            <rect
              key={cell.key}
              className="cg-heat-cell"
              data-level={cell.level}
              x={cell.x}
              y={cell.y}
              width={CELL}
              height={CELL}
              rx={3}
            >
              <title>{cell.label}</title>
            </rect>
          ))}
        </svg>
      </div>
    </div>
  );
}
