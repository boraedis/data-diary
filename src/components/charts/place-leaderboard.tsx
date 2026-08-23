import type { PlaceLeaderboardEntry } from "@/lib/charts";

/** A plain HTML/CSS ranked list, deliberately not an SVG chart — the legacy
 * app's `location_leaderboard` (functions/views/vis/charts/
 * location_leaderboard.js) rendered as a DOM table too, and a bar-width-by-
 * percentage row is both simpler and more accessible than an SVG bar chart
 * for "just show me a ranking." Establishes the non-SVG half of the shared
 * chart pattern alongside the four D3 components. */
export function PlaceLeaderboard({ entries }: { entries: PlaceLeaderboardEntry[] }) {
  const max = Math.max(1, ...entries.map((e) => e.value));

  return (
    <ol className="space-y-2">
      {entries.map((entry, i) => (
        <li key={entry.name} className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm">{entry.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{entry.value}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(entry.value / max) * 100}%`,
                  backgroundColor: "var(--chart-1)",
                }}
              />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
