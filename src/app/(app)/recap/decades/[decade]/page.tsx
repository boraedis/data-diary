import { notFound } from "next/navigation";
import { ChartPage } from "@/components/charts/chart-page";
import { RecapGate } from "@/components/recap/recap-gate";
import { todayDateString } from "@/lib/date";
import { decadeCoverageNote, getRecapDataRange, parseDecadeSegment } from "@/lib/recap";

export const dynamic = "force-dynamic";

// A ten-year recap (#520): `/recap/decades/2010s`, or `/recap/decades/last-10`
// for the ten years ending at the last completed year. The static `decades`
// segment can't collide with `[year]` (four digits only), the same way
// `chapters` doesn't.
//
// Publish gate decision, documented here because it's the issue's open
// question: calendar decades are gated like any period, so the 2020s stays
// "ready on 2030-01-04" for years, and the trailing-ten window exists so
// there's something to open now. The gate is the same `RecapGate` every
// other period goes through — nothing decade-specific.

export default async function RecapDecadePage({
  params,
  searchParams,
}: {
  params: Promise<{ decade: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { decade: segment } = await params;
  const { preview } = await searchParams;
  const period = parseDecadeSegment(segment, todayDateString());
  // As with years: a malformed segment 404s, a well-formed decade with
  // nothing logged renders as an empty recap.
  if (period === null) notFound();

  const coverage = decadeCoverageNote(period, await getRecapDataRange());
  return (
    <ChartPage
      title={`Recap ${period.label}`}
      backHref="/recap"
      backLabel="Recap"
      description={coverage ?? undefined}
    >
      <RecapGate period={period} preview={preview === "1"} />
    </ChartPage>
  );
}
