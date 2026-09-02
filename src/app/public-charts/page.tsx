import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { WeightScrollerChart } from "@/components/charts/weight-scroller-chart";
import { HappinessAveragerChart } from "@/components/charts/happiness-averager-chart";
import { SleepCalendarChart } from "@/components/charts/sleep-calendar-chart";
import { getPublicHappinessTrendData, getPublicSleepData, getPublicWeightData } from "@/lib/public-charts";

// Curated public showcase (#84) — reuses the same chart components and
// chart-card/chart-page shell as the authenticated /charts/* pages for
// visual consistency, but every one is fed by public-charts.ts's own
// queries, never the authenticated endpoints those private pages use.
// No filters/drill-down row (filters={null}) — that's the private
// /charts section's job; this is a read-only showcase, not a second copy
// of it.
export const dynamic = "force-dynamic";

export default async function PublicChartsPage() {
  const [weight, happinessTrend, sleep] = await Promise.all([
    getPublicWeightData(),
    getPublicHappinessTrendData(),
    getPublicSleepData(),
  ]);

  return (
    <ChartPage title="Charts" backHref="/" backLabel="Front page" filters={null}>
      <div className="flex flex-col gap-6">
        <ChartCard
          title="Weight over time"
          description="Drag on the strip below the chart to zoom into a range; click to reset."
          empty={weight.length === 0}
        >
          <WeightScrollerChart data={weight} />
        </ChartCard>
        <ChartCard
          title="Happiness trend"
          description="Monthly average, marker size shows how many days fed each point; shaded band shows that month's day-to-day range."
          empty={happinessTrend.length === 0}
        >
          <HappinessAveragerChart data={happinessTrend} />
        </ChartCard>
        <ChartCard
          title="Sleep calendar"
          description="Nightly sleep duration, darker = less sleep, brighter = more."
          empty={sleep.length === 0}
        >
          <SleepCalendarChart data={sleep} />
        </ChartCard>
      </div>
    </ChartPage>
  );
}
