import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { TrainingVolumeChart } from "@/components/charts/training-volume-chart";
import { getTrainingVolumeData } from "@/lib/charts";

export const dynamic = "force-dynamic";

export default async function TrainingVolumeChartPage() {
  const data = await getTrainingVolumeData();

  return (
    <ChartPage title="Training volume">
      <ChartCard
        title="Training volume"
        description="Total hours trained each month. Hover a month for the days, exercises and average session length behind it."
        empty={data.length === 0}
      >
        <TrainingVolumeChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
