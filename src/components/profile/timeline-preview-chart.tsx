"use client";

import { todayDateString } from "@/lib/date";

export type TimelineChartEntry = {
  id: number;
  name: string;
  start: string;
  end: string | null;
  color: string | null;
};

// Cycled by row index for entries with no explicit color — fixed order,
// same chart-N custom properties the manage hub's catalog cards already
// use for accent borders (see CATALOGS in src/app/manage/page.tsx).
const FALLBACK_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const ROW_HEIGHT = 28;
const BAR_HEIGHT = 10;
const CHART_WIDTH = 600;
const LABEL_WIDTH = 160;

/**
 * Small preview timeline (Gantt-style horizontal bars) for the profile
 * editor's occupation/residence/relationship lists — see #11. Deliberately
 * a plain SVG rather than a D3-driven chart: this is a compact glance-view
 * embedded in the editor, not one of the full interactive charts under
 * /charts (crosshair/tooltip there, a native <title> here is enough for
 * "what date range is this bar"). Bars run oldest-at-top; an entry with no
 * `end` runs to today rather than stopping short, so "still ongoing" reads
 * visually as "reaches the right edge."
 */
export function TimelinePreviewChart({ entries }: { entries: TimelineChartEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>;
  }

  const today = todayDateString();
  const chronological = [...entries].sort((a, b) => a.start.localeCompare(b.start));
  const minDate = chronological[0].start;
  const maxDate = chronological.reduce((max, e) => (e.end && e.end > max ? e.end : max), today);

  const minMs = new Date(minDate).getTime();
  const maxMs = new Date(maxDate).getTime();
  const span = Math.max(maxMs - minMs, 1);
  const plotWidth = CHART_WIDTH - LABEL_WIDTH;

  function x(dateStr: string): number {
    const ms = new Date(dateStr).getTime();
    return LABEL_WIDTH + ((ms - minMs) / span) * plotWidth;
  }

  const height = chronological.length * ROW_HEIGHT;

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${height}`}
      width="100%"
      height={height}
      role="img"
      aria-label="Timeline preview"
    >
      {chronological.map((entry, i) => {
        const barStart = x(entry.start);
        const barEnd = x(entry.end ?? today);
        const barWidth = Math.max(barEnd - barStart, 3);
        const y = i * ROW_HEIGHT;
        const color = entry.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length];
        const rangeLabel = entry.end ? `${entry.start} – ${entry.end}` : `${entry.start} – present`;
        return (
          <g key={entry.id}>
            <title>{`${entry.name}: ${rangeLabel}`}</title>
            <text
              x={LABEL_WIDTH - 8}
              y={y + ROW_HEIGHT / 2}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-foreground text-[10px]"
            >
              {entry.name.length > 20 ? `${entry.name.slice(0, 19)}…` : entry.name}
            </text>
            <rect
              x={barStart}
              y={y + (ROW_HEIGHT - BAR_HEIGHT) / 2}
              width={barWidth}
              height={BAR_HEIGHT}
              rx={4}
              fill={color}
            />
          </g>
        );
      })}
    </svg>
  );
}
