"use client";

import { useMemo, useOptimistic, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { GroupByPicker } from "@/components/charts/interactive/group-by-picker";
import { InteractiveRanked, type RankedColumn } from "@/components/charts/interactive/interactive-ranked";
import type { LeaderboardPicker } from "@/lib/leaderboards/options";
import { movementOf, type LeaderboardColumns, type LeaderboardRow, type LeaderboardValueFormat } from "@/lib/leaderboards/rows";
import { STANDARD_RANK_WINDOWS } from "@/lib/ranking";
import { formatDuration, formatHoursTotal, formatThousandsNumber } from "@/lib/viz/format";
import { RANKED_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import type { TrackingSpan } from "@/lib/viz/tracking-span";

// The leaderboard pages' shared client layer (#115). Every leaderboard —
// places, people, music, podcasts, entertainment, sports, exercise — is
// the same `LeaderboardRow[]` plus a `LeaderboardColumns` config, built on
// the server; these two components turn that into InteractiveRanked
// columns and the page around it. A domain adds a leaderboard by writing
// a data module in src/lib/leaderboards/, not a component.

const SCORE_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const SCORE_EXACT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const DAYS_SMALL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

const FORMATS: Record<LeaderboardValueFormat, { display: (v: number) => string; exact: (v: number) => string }> = {
  count: { display: (v) => formatThousandsNumber(Math.round(v)), exact: (v) => formatThousandsNumber(Math.round(v)) },
  // Fractional by construction (places split a day ⅔ / ⅓): whole days
  // once there are enough of them, a decimal below 10 where the fraction
  // is most of the number, and the exact tenth on hover.
  days: {
    display: (v) => (Math.abs(v) < 10 ? DAYS_SMALL.format(v) : formatThousandsNumber(Math.round(v))),
    exact: (v) => `${DAYS_SMALL.format(v)} ${Math.abs(v) === 1 ? "day" : "days"}`,
  },
  hours: { display: formatHoursTotal, exact: formatDuration },
  score: { display: (v) => SCORE_FORMAT.format(v), exact: (v) => SCORE_EXACT.format(v) },
};

/** InteractiveRanked columns for one leaderboard config. */
function buildColumns(config: LeaderboardColumns, hasMovement: boolean): RankedColumn<LeaderboardRow>[] {
  const format = FORMATS[config.valueFormat];
  const hasContext = config.contextHeader !== undefined;
  const cols: RankedColumn<LeaderboardRow>[] = [
    {
      kind: "text",
      id: "name",
      header: config.nameHeader,
      value: (r) => r.name,
      detail: (r) => r.detail,
      // With no context column, the row's colour (a tag, a team, a genre
      // group) tints the name instead of being lost.
      cellColor: hasContext ? undefined : { color: (r) => r.color },
    },
  ];
  if (hasContext) {
    cols.push({
      kind: "text",
      id: "context",
      header: config.contextHeader as string,
      description: config.contextDescription,
      value: (r) => r.context,
      cellColor: { color: (r) => r.color },
      hideBelow: "md",
    });
  }
  cols.push({
    kind: "number",
    id: "value",
    header: config.valueHeader,
    description: config.valueDescription,
    value: (r) => r.value,
    format: format.display,
    exact: format.exact,
    // Log for counts and time: every one of these is heavy-tailed (home,
    // a best friend, a favourite artist), and a linear ramp paints the
    // rest of the table one pale step. Scores can dip below zero, which
    // log can't hold, so they stay linear.
    conditional: { type: "scale", log: config.valueFormat !== "score" },
  });
  if (config.countHeader) {
    cols.push({
      kind: "number",
      id: "count",
      header: config.countHeader,
      description: config.countDescription,
      value: (r) => r.count,
      hideBelow: "sm",
    });
  }
  if (hasMovement) {
    STANDARD_RANK_WINDOWS.forEach((window, i) => {
      const since = window.since ?? window.label;
      cols.push({
        kind: "movement",
        id: window.id,
        header: window.label,
        description: `The ${config.gainedNoun}, and places moved in the ranking, since ${since}.`,
        movement: (r) => movementOf(r, i),
        gained: (r) => r.gained?.[i] ?? null,
        formatGained: format.display,
        since,
        // Week stays on a phone; month and year are the first to go.
        hideBelow: window.id === "week" ? undefined : window.id === "month" ? "sm" : "md",
      });
    });
  }
  return cols;
}

/** The table alone — used by the recap, which has its own section chrome. */
export function LeaderboardTable({
  rows,
  columns,
  ariaLabel,
}: {
  rows: LeaderboardRow[];
  columns: LeaderboardColumns;
  ariaLabel: string;
}) {
  const hasMovement = rows.some((r) => r.previousRanks !== null);
  const rankedColumns = useMemo(() => buildColumns(columns, hasMovement), [columns, hasMovement]);
  return (
    <InteractiveRanked
      rows={rows}
      getKey={(r) => r.key}
      rank={(r) => r.rank}
      columns={rankedColumns}
      ariaLabel={ariaLabel}
    />
  );
}

/**
 * A full leaderboard page: title, pickers and table.
 *
 * **Pickers live in the URL** (`?by=artist`), and a change is a server
 * round trip rather than a client-side regroup. That's deliberate: the
 * server only fetches and ranks the mode on screen, and for music a single
 * mode can be ~17k rows — shipping every mode up front to regroup locally
 * would multiply that. It also makes a view linkable.
 *
 * The picker shows the new choice immediately (`useOptimistic`) and the
 * table dims until the new rows arrive, so a slow mode doesn't read as a
 * click that didn't register.
 */
export function LeaderboardExplorer({
  title,
  description,
  methodology,
  trackingSpan,
  pickers,
  rows,
  columns,
  ariaLabel,
}: {
  title: string;
  description: string;
  methodology?: string;
  trackingSpan?: TrackingSpan;
  pickers: LeaderboardPicker[];
  rows: LeaderboardRow[];
  columns: LeaderboardColumns;
  ariaLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [values, setOptimisticValues] = useOptimistic(pickers.map((p) => p.value));

  const onPick = (index: number, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(pickers[index].param, value);
    // A later picker only means something under the choice that showed
    // it (a region level under Top Regions), so changing an earlier one
    // clears the rest back to their defaults.
    for (const later of pickers.slice(index + 1)) params.delete(later.param);
    startTransition(() => {
      setOptimisticValues(pickers.map((p, i) => (i === index ? value : i < index ? values[i] : p.options[0].id)));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <ChartPage
      title={title}
      description={description}
      info={{ interactionGuide: RANKED_INTERACTION_GUIDE, methodology, trackingSpan }}
      filters={
        pickers.length > 0 ? (
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {pickers.map((picker, i) => (
              <GroupByPicker
                key={picker.param}
                label={picker.label}
                value={values[i] ?? picker.value}
                options={picker.options}
                onChange={(value) => onPick(i, value)}
              />
            ))}
          </div>
        ) : undefined
      }
    >
      <ChartCard empty={rows.length === 0}>
        <div aria-busy={pending} className={`transition-opacity ${pending ? "opacity-50" : ""}`}>
          <LeaderboardTable rows={rows} columns={columns} ariaLabel={ariaLabel} />
        </div>
      </ChartCard>
    </ChartPage>
  );
}
