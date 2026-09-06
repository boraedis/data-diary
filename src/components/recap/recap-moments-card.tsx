import { ChartCard } from "@/components/charts/chart-card";
import { formatDate } from "@/lib/viz/format";
import type { RecapMoment } from "@/lib/recap-moments";

// The moments section of the recap report (issue #174, epic #130).
//
// Ranked by magnitude rather than shown chronologically: the story tier
// (#175) takes the top few, so the ordering has to mean "most worth
// telling" and not "earliest". The date is on every row, so chronology is
// still legible without being the sort.

/** The detailed report shows a bounded list — the ranking exists so the
 * interesting ones come first, and a year with forty qualifying days
 * shouldn't turn this card into a scroll. The tail isn't lost so much as
 * not worth a row. */
const MAX_SHOWN = 12;

export function RecapMomentsCard({
  moments,
  periodLabel,
}: {
  moments: RecapMoment[];
  periodLabel: string;
}) {
  const shown = moments.slice(0, MAX_SHOWN);

  return (
    <ChartCard
      title="Moments"
      description={`Automatically picked highs, lows and first times from ${periodLabel}.`}
      empty={moments.length === 0}
    >
      <ul className="flex flex-col">
        {shown.map((moment) => (
          <li
            key={`${moment.kind}-${moment.date}`}
            className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 last:border-0"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{moment.headline}</span>
              {moment.detail ? (
                <span className="text-xs text-muted-foreground">{moment.detail}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDate(moment.date, "weekdayYear")}
            </span>
          </li>
        ))}
      </ul>
      {moments.length > MAX_SHOWN ? (
        <p className="pt-3 text-xs text-muted-foreground">
          and {moments.length - MAX_SHOWN} more
        </p>
      ) : null}
    </ChartCard>
  );
}
