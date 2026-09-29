import { notFound } from "next/navigation";
import { ChartPage } from "@/components/charts/chart-page";
import { RecapMonthNav } from "@/components/recap/recap-month-nav";
import { RecapReport } from "@/components/recap/recap-report";
import { listRecapMonths, monthPeriod, parseMonthSegment, parseYearSegment } from "@/lib/recap";

export const dynamic = "force-dynamic";

// A month's recap (#176) — the annual machinery at month scope. Everything
// month-specific about *what's shown* is decided inside `RecapReport` from
// the period itself; this route only parses the URL and supplies the
// month nav, the same row the year page shows with this month selected.

export default async function RecapMonthPage({
  params,
}: {
  params: Promise<{ year: string; month: string }>;
}) {
  const { year: yearSegment, month: monthSegment } = await params;
  const year = parseYearSegment(yearSegment);
  const month = parseMonthSegment(monthSegment);
  // Same rule as the year route: a malformed segment 404s, a well-formed
  // month with nothing logged renders its empty recap.
  if (year === null || month === null) notFound();

  const period = monthPeriod(year, month);
  const months = await listRecapMonths(year);

  return (
    <ChartPage
      title={`Recap ${period.label}`}
      backHref={`/recap/${year}`}
      backLabel={String(year)}
      filters={months.length > 0 ? <RecapMonthNav year={year} months={months} current={month} /> : null}
    >
      <RecapReport period={period} />
    </ChartPage>
  );
}
