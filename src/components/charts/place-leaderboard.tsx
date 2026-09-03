import { InteractiveRanked } from "@/components/charts/interactive/interactive-ranked";
import type { PlaceLeaderboardEntry } from "@/lib/charts";

/** A plain HTML/CSS ranked list, deliberately not an SVG chart — the legacy
 * app's `location_leaderboard` (functions/views/vis/charts/
 * location_leaderboard.js) rendered as a DOM table too, and a bar-width-by-
 * percentage row is both simpler and more accessible than an SVG bar chart
 * for "just show me a ranking." Now a thin wrapper around the shared
 * InteractiveRanked primitive (#22) instead of its own bespoke list. */
export function PlaceLeaderboard({ entries }: { entries: PlaceLeaderboardEntry[] }) {
  return (
    <InteractiveRanked
      entries={entries.map((e) => ({ label: e.name, value: e.value }))}
      ariaLabel="Most-visited places, ranked."
    />
  );
}
