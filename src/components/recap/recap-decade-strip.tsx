import { ChartCard } from "@/components/charts/chart-card";
import { MIN_DAYS_FOR_AVERAGE } from "@/lib/recap";
import { happinessByYear, type HappinessDay } from "@/lib/recap-health";
import { categoricalColor } from "@/lib/viz/color";

// The decade recap's one new card (#520): average happiness, year by year.
// A ten-year recap's other cards are the year's cards over a longer window;
// this is the ingredient only a longer window has. Kept to a plain bar list
// rather than a chart primitive — ten rows, no interaction worth the
// weight — and the monthly trend already in the health section covers the
// shape over time.
//
// Bars are scaled 0-100, the score's own range, not to the data's extent:
// a decade of 84–91 should look like a steady decade, not a dramatic one.
// A year with fewer than `MIN_DAYS_FOR_AVERAGE` scored days is still shown
// (it's a true mean) but drawn muted and labelled with its day count,
// the same threshold every other average in the recap respects.

export function RecapDecadeStrip({ series }: { series: HappinessDay[] }) {
  const years = happinessByYear(series);
  return (
    <ChartCard
      title="Year by year"
      description="Average happiness in each year of the period."
      empty={years.length === 0}
    >
      <ul className="flex flex-col gap-2">
        {years.map(({ year, average, daysLogged }) => {
          const thin = daysLogged < MIN_DAYS_FOR_AVERAGE;
          return (
            <li key={year} className="flex items-center gap-3 text-sm">
              <span className="w-10 shrink-0 tabular-nums text-muted-foreground">{year}</span>
              <div className="h-3 flex-1 rounded-sm bg-muted">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${Math.max(0, Math.min(100, average))}%`,
                    backgroundColor: thin ? "var(--muted-foreground)" : categoricalColor(2),
                    opacity: thin ? 0.5 : 1,
                  }}
                />
              </div>
              <span className="w-24 shrink-0 text-right tabular-nums">
                {Math.round(average)}
                <span className="ml-1 text-xs text-muted-foreground">
                  {thin ? `${daysLogged} days` : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}
