import { notFound } from "next/navigation";
import { ChartPage } from "@/components/charts/chart-page";
import { RecapMonthNav } from "@/components/recap/recap-month-nav";
import { RecapGate } from "@/components/recap/recap-gate";
import { listRecapMonths, parseYearSegment, yearPeriod } from "@/lib/recap";

export const dynamic = "force-dynamic";

// A year's recap. The report itself — both tiers, every section — lives in
// `RecapReport`, shared with the month route (#176); this page only picks
// the period and adds the month index for the year. `RecapGate` decides
// whether the year is published yet (#517) — on its own clock, so the month
// nav below can list finished months of a year that isn't out.

export default async function RecapYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { year: segment } = await params;
  const { preview } = await searchParams;
  const year = parseYearSegment(segment);
  // A malformed segment 404s; a well-formed year with nothing logged
  // renders as an empty recap, because "you logged nothing in 2011" is a
  // true answer and a 404 isn't.
  if (year === null) notFound();

  const period = yearPeriod(year);
  const months = await listRecapMonths(year);

  return (
    <ChartPage
      title={`Recap ${period.label}`}
      backHref="/recap"
      backLabel="Recap"
      filters={months.length > 0 ? <RecapMonthNav year={year} months={months} current={null} /> : null}
    >
      <RecapGate period={period} preview={preview === "1"} />
    </ChartPage>
  );
}
