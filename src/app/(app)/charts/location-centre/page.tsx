import { LocationCentreChart } from "@/components/charts/location-centre-chart";
import { getLocationCentreData } from "@/lib/charts";

export const dynamic = "force-dynamic";

// The chart component owns the page shell (ChartPage + filters + card), the
// same way /charts/city-heatmap does: the period picker and the map share
// state, and only plain data can cross the server/client boundary.
export default async function Page() {
  const data = await getLocationCentreData();
  return <LocationCentreChart data={data} />;
}
