import { ChartCard } from "@/components/charts/chart-card";
import { RecapWeightTrend } from "@/components/recap/recap-body-charts";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { MIN_DAYS_FOR_AVERAGE, MIN_DAYS_FOR_TOTAL, toRecapStat } from "@/lib/recap";
import type { RecapBody } from "@/lib/recap-body";
import { formatDate, formatDuration } from "@/lib/viz/format";

// The body & habits section of the recap report (#529, slice 3 of #521).
// The rules live in `recap-body.ts`'s header: averages over *logged* days
// gated on `MIN_DAYS_FOR_AVERAGE`, training hours gated on
// `MIN_DAYS_FOR_TOTAL`, and neutral phrasing throughout.

const oneDecimal = (value: number) => value.toFixed(1);

export function RecapBodySection({
  body,
  periodLabel,
  priorLabel,
}: {
  body: RecapBody;
  periodLabel: string;
  priorLabel: string;
}) {
  const { weight, coffee, distance, training } = body;
  const hasAnything =
    weight.daysLogged > 0 || coffee.daysLogged > 0 || distance.daysLogged > 0 || training.hours > 0;
  const showTrend = weight.daysLogged >= MIN_DAYS_FOR_AVERAGE;

  return (
    <ChartCard
      title="Body & habits"
      description={`Weight, coffee, walking and training in ${periodLabel}.`}
      empty={!hasAnything}
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {weight.daysLogged > 0 ? (
            <RecapStatCard
              label="Average weight"
              unit="kg"
              format={oneDecimal}
              priorLabel={priorLabel}
              detail={
                weight.first && weight.last && weight.first.date !== weight.last.date
                  ? `${oneDecimal(weight.first.value)} kg on ${formatDate(weight.first.date, "short")} → ${oneDecimal(weight.last.value)} kg on ${formatDate(weight.last.date, "short")}`
                  : undefined
              }
              stat={toRecapStat({
                value: weight.average ?? 0,
                loggedDays: weight.daysLogged,
                requiredDays: MIN_DAYS_FOR_AVERAGE,
                prior: weight.priorAverage,
                priorLoggedDays: weight.priorDaysLogged,
              })}
            />
          ) : null}
          {coffee.daysLogged > 0 ? (
            <RecapStatCard
              label="Coffees per day"
              unit="cups"
              format={oneDecimal}
              priorLabel={priorLabel}
              detail={`${coffee.total.toLocaleString()} cups across ${coffee.daysLogged.toLocaleString()} logged days`}
              stat={toRecapStat({
                value: coffee.average ?? 0,
                loggedDays: coffee.daysLogged,
                requiredDays: MIN_DAYS_FOR_AVERAGE,
                prior: coffee.priorAverage,
                priorLoggedDays: coffee.priorDaysLogged,
              })}
            />
          ) : null}
          {distance.daysLogged > 0 ? (
            <RecapStatCard
              label="Distance walked per day"
              unit="km"
              format={oneDecimal}
              priorLabel={priorLabel}
              detail={`${Math.round(distance.total).toLocaleString()} km across ${distance.daysLogged.toLocaleString()} logged days`}
              stat={toRecapStat({
                value: distance.average ?? 0,
                loggedDays: distance.daysLogged,
                requiredDays: MIN_DAYS_FOR_AVERAGE,
                prior: distance.priorAverage,
                priorLoggedDays: distance.priorDaysLogged,
              })}
            />
          ) : null}
          {training.hours > 0 ? (
            <RecapStatCard
              label="Time trained"
              format={(hours) => formatDuration(hours)}
              priorLabel={priorLabel}
              detail={`Timed workouts only · ${training.daysTrained.toLocaleString()} days`}
              stat={toRecapStat({
                value: training.hours,
                loggedDays: training.daysTrained,
                requiredDays: MIN_DAYS_FOR_TOTAL,
                prior: training.priorHours,
                priorLoggedDays: training.priorDaysTrained,
              })}
            />
          ) : null}
        </div>

        {showTrend ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Weight trend
            </h3>
            <RecapWeightTrend series={weight.series} periodLabel={periodLabel} />
          </section>
        ) : null}
      </div>
    </ChartCard>
  );
}
