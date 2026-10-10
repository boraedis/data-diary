import { CityHeatmapExplorer } from "@/components/charts/city-heatmap-explorer";
import { getCityHeatmapData } from "@/lib/charts";
import { CITIES, DEFAULT_CITY, type CityKey } from "@/lib/geo/city-config";
import { getProfileSettings } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function CityHeatmapChartPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const cityKeys = Object.keys(CITIES) as CityKey[];
  // `?city=` is the picker's state (see CityHeatmapExplorer). Anything that
  // isn't one of our keys, including a repeated param, falls back to the
  // default rather than erroring.
  const { city } = await searchParams;
  const initialCity = typeof city === "string" && city in CITIES ? (city as CityKey) : DEFAULT_CITY;
  const [results, { diaryStartDate }] = await Promise.all([
    Promise.all(cityKeys.map((key) => getCityHeatmapData(key))),
    getProfileSettings(),
  ]);
  const data = Object.fromEntries(cityKeys.map((key, i) => [key, results[i]])) as Record<
    CityKey,
    Awaited<ReturnType<typeof getCityHeatmapData>>
  >;

  return <CityHeatmapExplorer data={data} diaryStartDate={diaryStartDate} initialCity={initialCity} />;
}
