import Link from "next/link";
import { ChartCard } from "@/components/charts/chart-card";
import { SleepCalendarChart } from "@/components/charts/sleep-calendar-chart";
import { getSleepCalendarData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function SleepChartPage() {
  const data = await getSleepCalendarData();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-4xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">
          Sleep calendar
        </h1>
        <Link href="/charts" className="text-xs text-muted-foreground hover:text-foreground">
          Charts
        </Link>
      </div>
      <ChartCard
        title="Sleep calendar"
        description="Nightly sleep duration, darker = less sleep, brighter teal = more."
        empty={data.length === 0}
      >
        <SleepCalendarChart data={data} />
      </ChartCard>
    </main>
  );
}
