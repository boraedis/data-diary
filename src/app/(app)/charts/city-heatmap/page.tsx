import { CityHeatmapExplorer } from "@/components/charts/city-heatmap-explorer";
import { getCityHeatmapData } from "@/lib/charts";
import { CITIES, type CityKey } from "@/lib/geo/city-config";

export const dynamic = "force-dynamic";

export default async function CityHeatmapChartPage() {
  const cityKeys = Object.keys(CITIES) as CityKey[];
  const results = await Promise.all(cityKeys.map((key) => getCityHeatmapData(key)));
  const data = Object.fromEntries(cityKeys.map((key, i) => [key, results[i]])) as Record<
    CityKey,
    Awaited<ReturnType<typeof getCityHeatmapData>>
  >;

  return <CityHeatmapExplorer data={data} />;
}
