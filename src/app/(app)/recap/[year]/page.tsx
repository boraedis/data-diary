import { notFound } from "next/navigation";
import { ChartPage } from "@/components/charts/chart-page";
import { RecapMonthNav } from "@/components/recap/recap-month-nav";
import { RecapReport } from "@/components/recap/recap-report";
import { listRecapMonths, parseYearSegment, yearPeriod } from "@/lib/recap";

export const dynamic = "force-dynamic";

// A year's recap. The report itself — both tiers, every section — lives in
// `RecapReport`, shared with the month route (#176); this page only picks
// the period and adds the month index for the year.

export default async function RecapYearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: segment } = await params;
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
      <RecapReport period={period} />
    </ChartPage>
  );
}
