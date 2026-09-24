"use client";

import { useMemo, useState } from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import { InteractiveRanked, type RankedColumn } from "@/components/charts/interactive/interactive-ranked";
import type { PlaceLeaderboardEntry } from "@/lib/place-leaderboard";
import { STANDARD_RANK_WINDOWS } from "@/lib/ranking";
import { RANKED_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

/**
 * The places leaderboard table (#115): Place, Path, Mentions and
 * week/month/year rank movement, on the shared InteractiveRanked
 * primitive.
 *
 * Also used by the recap's people & places section with period-scoped
 * rows. Those carry no path or movement (see buildRecapPeoplePlaces), and
 * the columns for them are dropped rather than drawn as a column of
 * blanks.
 */
export function PlaceLeaderboard({
  entries,
  ariaLabel = "Most-mentioned places, ranked, with how each one's ranking has moved over the last week, month and year.",
}: {
  entries: PlaceLeaderboardEntry[];
  ariaLabel?: string;
}) {
  const hasPath = entries.some((e) => e.path !== null && e.path.length > 0);
  const hasMovement = entries.some((e) => e.movements !== null);

  const columns = useMemo<RankedColumn<PlaceLeaderboardEntry>[]>(() => {
    const cols: RankedColumn<PlaceLeaderboardEntry>[] = [
      {
        kind: "text",
        id: "place",
        header: "Place",
        value: (e) => e.name,
        // Without a path column (the recap), the country colour moves onto
        // the name instead of being lost.
        cellColor: hasPath ? undefined : { color: (e) => e.color },
      },
    ];
    if (hasPath) {
      cols.push({
        kind: "text",
        id: "path",
        header: "Path",
        description: "Where the place sits in the hierarchy, coloured by its country.",
        // A root place (a country) is its own path, so its row isn't
        // left as an uncoloured blank in a column of coloured ones.
        value: (e) => (e.path && e.path.length > 0 ? e.path.join(" › ") : e.name),
        cellColor: { color: (e) => e.color },
        hideBelow: "md",
      });
    }
    cols.push({
      kind: "number",
      id: "mentions",
      header: "Mentions",
      description: "Slot-weighted: a day's first place counts 2, its second counts 1.",
      value: (e) => e.value,
      // Log: home alone dwarfs everything else, and a linear ramp would
      // paint the rest of the table the same pale step.
      conditional: { type: "scale", log: true },
    });
    if (hasMovement) {
      for (const window of STANDARD_RANK_WINDOWS) {
        cols.push({
          kind: "movement",
          id: window.id,
          header: window.label,
          description: `Mentions gained, and places moved in the ranking, since ${window.since ?? window.label}.`,
          movement: (e) => e.movements?.[window.id] ?? null,
          gained: (e) => e.gained?.[window.id] ?? null,
          since: window.since ?? window.label,
          // Week stays on a phone; month and year are the first to go.
          hideBelow: window.id === "week" ? undefined : window.id === "month" ? "sm" : "md",
        });
      }
    }
    return cols;
  }, [hasPath, hasMovement]);

  return (
    <InteractiveRanked
      rows={entries}
      getKey={(e) => String(e.id)}
      rank={(e) => e.rank}
      columns={columns}
      ariaLabel={ariaLabel}
    />
  );
}

type TableLimit = "25" | "50" | "100" | "all";

const LIMIT_OPTIONS: GroupByOption<TableLimit>[] = [
  { id: "25", label: "Top 25" },
  { id: "50", label: "Top 50" },
  { id: "100", label: "Top 100" },
  { id: "all", label: "All" },
];

/** The /charts/places page body. Owns the page shell so the "Show" filter
 * and the table can share state — same pattern as PeopleTableChart. */
export function PlaceLeaderboardChart({ entries }: { entries: PlaceLeaderboardEntry[] }) {
  const [limit, setLimit] = useState<TableLimit>("25");
  const shown = useMemo(() => (limit === "all" ? entries : entries.slice(0, Number(limit))), [entries, limit]);

  return (
    <ChartPage
      title="Place Leaderboard"
      description="A leaderboard of my most mentioned locations, and how each one's standing has moved over the last week, month and year."
      info={{
        interactionGuide: RANKED_INTERACTION_GUIDE,
        methodology: PLACES_METHODOLOGY,
        trackingSpan: PLACES_TRACKING_SPAN,
      }}
      filters={<GroupByPicker value={limit} onChange={setLimit} options={LIMIT_OPTIONS} label="Show" />}
    >
      <ChartCard empty={shown.length === 0}>
        <PlaceLeaderboard entries={shown} />
      </ChartCard>
    </ChartPage>
  );
}
