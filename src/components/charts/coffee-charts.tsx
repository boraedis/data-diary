"use client";

import { CalendarExplorer } from "@/components/charts/calendar-explorer";
import { TrendExplorer } from "@/components/charts/trend-explorer";
import { categoricalColor } from "@/lib/viz/color";
import type { DailyValue } from "@/lib/charts";

// Per-chart client components configuring a shared explorer.
//
// This layer exists because the explorers take formatter *functions*, and a
// page under app/ is a server component — passing those straight from the
// page throws "Functions cannot be passed directly to Client Components" at
// render time, which no amount of type checking or `next build` will catch.
// The page fetches and passes plain data; presentation is declared on the
// client side of the boundary.

const cups = (n: number) => `${n.toFixed(1)} cups`;

export function CoffeeTrendChart({ data }: { data: DailyValue[] }) {
  return (
    <TrendExplorer
      data={data}
      title="Coffee trend"
      description="Average cups per day. Marker size shows how many days fed each point; the band shows that bucket's range."
      seriesId="coffee"
      label="Coffee"
      color={categoricalColor(0)}
      getValue={(d) => d.value}
      aggregate="mean"
      valueFormat={cups}
      ariaLabel="Average cups of coffee per day over time. Use arrow keys to inspect individual buckets, or hover a point."
    />
  );
}

export function CoffeeCalendarChart({ data }: { data: DailyValue[] }) {
  return (
    <CalendarExplorer
      data={data}
      title="Coffee calendar"
      description="A year-by-year heatmap of cups per day. Hover a day for the exact count."
      formatValue={(n) => `${n} cup${n === 1 ? "" : "s"}`}
      valueLabel="coffee"
      ariaLabel="Coffee calendar heatmap. Hover a day to see how many cups you had."
    />
  );
}
