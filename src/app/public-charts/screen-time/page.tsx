import type { Metadata } from "next";
import { DeviceUsageChart } from "@/components/charts/technology-charts";
import { getPublicDeviceUsageData } from "@/lib/public-charts";

export const metadata: Metadata = {
  title: "Screen Time Mix — Data Diary",
  description: "A breakdown of phone vs. laptop usage, aggregated by period.",
};

// Public counterpart to src/app/(app)/charts/screen-time/page.tsx (#453).
export const dynamic = "force-dynamic";

export default async function PublicDeviceUsageChartPage() {
  const data = await getPublicDeviceUsageData();
  return <DeviceUsageChart data={data} backHref="/public-charts" backLabel="Charts" />;
}
