"use client";

import { DailyValueCalendar } from "@/components/charts/daily-value-calendar";
import { MonthlyAverageChart } from "@/components/charts/monthly-average-chart";
import { categoricalColor } from "@/lib/viz/color";
import type { DailyValue, MonthlyAverage } from "@/lib/charts";

// Thin client components per chart, holding the formatting their generic
// building block needs.
//
// This layer isn't ceremony: `MonthlyAverageChart` and friends take
// formatter *functions*, and a page under app/ is a server component, so
// passing those straight from the page throws "Functions cannot be passed
// directly to Client Components". Formatting has to be declared on the
// client side of the boundary. It also matches what every other chart in
// this folder already does — the page fetches and passes plain data, the
// component owns presentation.

export function CoffeeTrendChart({ data }: { data: MonthlyAverage[] }) {
  return (
    <MonthlyAverageChart
      data={data}
      seriesId="coffee"
      label="Coffee"
      color={categoricalColor(0)}
      valueFormat={(v) => v.toFixed(1)}
      ariaLabel="Monthly average cups of coffee per day. Use arrow keys to inspect individual months, or hover a point."
    />
  );
}

export function CoffeeCalendarChart({ data }: { data: DailyValue[] }) {
  return (
    <DailyValueCalendar
      data={data}
      formatValue={(cups) => `${cups} cup${cups === 1 ? "" : "s"}`}
      valueLabel="coffee"
      ariaLabel="Coffee calendar heatmap. Hover a day to see how many cups you had."
    />
  );
}
