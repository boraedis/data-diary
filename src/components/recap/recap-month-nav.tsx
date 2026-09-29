import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/viz/format";
import { monthSegment, type RecapMonthSummary } from "@/lib/recap";

// The month index for one year (#176): the year itself plus each month
// that falls inside the logged history, as a single row of links in
// `ChartPage`'s filters slot. The same row appears on the year page and on
// each of its months, so moving between them is one click either way
// rather than a trip back through an index page.
//
// Links, not the `PeriodPicker` buttons it's styled after: each month is
// its own server-rendered route, so this is navigation, not client state.

export function RecapMonthNav({
  year,
  months,
  current,
}: {
  year: number;
  months: RecapMonthSummary[];
  /** The month on screen, or null on the whole-year page. */
  current: number | null;
}) {
  if (months.length === 0) return null;

  return (
    <nav aria-label={`Months of ${year}`} className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Month
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <Link
          href={`/recap/${year}`}
          aria-current={current === null ? "page" : undefined}
          className={buttonVariants({ size: "xs", variant: current === null ? "secondary" : "ghost" })}
        >
          All of {year}
        </Link>
        {months.map((summary) => {
          const active = summary.month === current;
          return (
            <Link
              key={summary.month}
              href={`/recap/${year}/${monthSegment(summary.month)}`}
              aria-current={active ? "page" : undefined}
              title={`${summary.loggedDays} day${summary.loggedDays === 1 ? "" : "s"} logged`}
              className={buttonVariants({
                size: "xs",
                variant: active ? "secondary" : "ghost",
                // A month with nothing logged still links — its recap says
                // so honestly, the same as an empty year — but reads as
                // quieter than the months that have something to show.
                className: summary.loggedDays === 0 && !active ? "text-muted-foreground/60" : undefined,
              })}
            >
              {formatDate(summary.period.start, "monthShort")}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
