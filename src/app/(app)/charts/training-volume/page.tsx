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
        description="Days trained each month. Hover a month to see how many individual exercises those days held."
        empty={data.length === 0}
      >
        <TrainingVolumeChart data={data} />
      </ChartCard>
    </ChartPage>
  );
}
