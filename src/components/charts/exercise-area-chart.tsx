"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveArea, type InteractiveAreaMode, type InteractiveAreaPoint } from "@/components/charts/interactive/interactive-area";
import type { ExerciseAreaData } from "@/lib/charts";

function parseMonth(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

/** Monthly workout count by exercise category — the first real consumer
 * of InteractiveArea (#19), replacing legacy's `exercise_area.js`. The
 * count/share toggle is chart-scoped state (not page-level filtering, the
 * way ChartPage's own `filters` row is meant for), so it lives here
 * rather than in the page component — the first chart in this app to need
 * *any* toggle, stacked/proportional being exactly the mode #19 requires
 * both work. */
export function ExerciseAreaChart({ data }: { data: ExerciseAreaData }) {
  const [mode, setMode] = useState<InteractiveAreaMode>("stacked");

  const points = useMemo<InteractiveAreaPoint[]>(
    () => data.points.map((p) => ({ x: parseMonth(p.month), values: p.values })),
    [data.points],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          variant={mode === "stacked" ? "secondary" : "ghost"}
          aria-pressed={mode === "stacked"}
          onClick={() => setMode("stacked")}
        >
          Count
        </Button>
        <Button
          type="button"
          size="xs"
          variant={mode === "proportional" ? "secondary" : "ghost"}
          aria-pressed={mode === "proportional"}
          onClick={() => setMode("proportional")}
        >
          % share
        </Button>
      </div>
      <ResponsiveChart height={320} minWidth={280}>
        {({ width, height }) => (
          <InteractiveArea
            categories={data.categories}
            points={points}
            width={width}
            height={height}
            mode={mode}
            valueFormat={(v) => `${v} workout${v === 1 ? "" : "s"}`}
            dateFormat="monthYear"
            ariaLabel="Workouts by exercise category over time. Hover or use arrow keys to inspect a month, click a legend entry to hide a category."
          />
        )}
      </ResponsiveChart>
    </div>
  );
}
