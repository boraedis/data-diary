import { ChartCard } from "@/components/charts/chart-card";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { formatDate, formatDuration } from "@/lib/viz/format";
import { MIN_DAYS_FOR_AVERAGE, MIN_DAYS_FOR_TOTAL, toRecapStat } from "@/lib/recap";
import type { RecapHealth } from "@/lib/recap-health";

// The health & wellness section of the recap report (issue #201, epic
// #130): happiness, sleep and exercise.
//
// The two averages here use `MIN_DAYS_FOR_AVERAGE`, the count uses
// `MIN_DAYS_FOR_TOTAL` — the distinction the foundation drew in #179 and
// that the subs section was the first to exercise. A mean over four logged
// nights isn't a year's sleep; a count of days trained over four logged
// days is still a true count.

/** Averages of a 0-100 score read better whole — "68" not "67.6". The
 * underlying value keeps its precision for the delta calculation. */
function formatScore(value: number): string {
  return Math.round(value).toString();
}

function formatMinutes(minutes: number): string {
  return formatDuration(minutes / 60);
}

export function RecapHealthSection({
  health,
  periodLabel,
  priorLabel,
}: {
  health: RecapHealth;
  periodLabel: string;
  priorLabel: string;
}) {
  const { happiness, sleep, exercise } = health;
  const hasAnything =
    happiness.daysLogged > 0 || sleep.nightsLogged > 0 || exercise.daysTrained > 0;

  return (
    <ChartCard
      title="Health & wellness"
      description={`How ${periodLabel} felt, how you slept, and how much you moved.`}
      empty={!hasAnything}
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RecapStatCard
            label="Average happiness"
            unit="/ 100"
            format={formatScore}
            priorLabel={priorLabel}
            stat={toRecapStat({
              value: happiness.average ?? 0,
              loggedDays: happiness.daysLogged,
              requiredDays: MIN_DAYS_FOR_AVERAGE,
              prior: happiness.priorAverage,
              priorLoggedDays: happiness.priorDaysLogged,
            })}
          />
          <RecapStatCard
            label="Average sleep"
            format={formatMinutes}
            priorLabel={priorLabel}
            stat={toRecapStat({
              value: sleep.averageMinutes ?? 0,
              loggedDays: sleep.nightsLogged,
              requiredDays: MIN_DAYS_FOR_AVERAGE,
              prior: sleep.priorAverageMinutes,
              priorLoggedDays: sleep.priorNightsLogged,
            })}
          />
          <RecapStatCard
            label="Days trained"
            unit="days"
            priorLabel={priorLabel}
            detail={
              exercise.exercisesLogged > 0
                ? `${exercise.exercisesLogged.toLocaleString()} exercises logged`
                : undefined
            }
            stat={toRecapStat({
              value: exercise.daysTrained,
              loggedDays: exercise.daysTrained,
              requiredDays: MIN_DAYS_FOR_TOTAL,
              prior: exercise.priorDaysTrained,
              priorLoggedDays: exercise.priorDaysTrained,
            })}
          />
        </div>

        <Highlights health={health} />
      </div>
    </ChartCard>
  );
}

function Highlights({ health }: { health: RecapHealth }) {
  const { happiness, sleep } = health;
  const items = [
    happiness.best
      ? {
          label: "Best day",
          value: formatDate(happiness.best.date, "weekdayYear"),
          note: `${happiness.best.happiness} / 100`,
        }
      : null,
    happiness.worst
      ? {
          label: "Worst day",
          value: formatDate(happiness.worst.date, "weekdayYear"),
          note: `${happiness.worst.happiness} / 100`,
        }
      : null,
    sleep.longest
      ? {
          label: "Longest night",
          value: formatMinutes(sleep.longest.durationMinutes),
          note: formatDate(sleep.longest.date, "weekdayYear"),
        }
      : null,
    sleep.shortest
      ? {
          label: "Shortest night",
          value: formatMinutes(sleep.shortest.durationMinutes),
          note: formatDate(sleep.shortest.date, "weekdayYear"),
        }
      : null,
  ].filter((item) => item !== null);

  if (items.length === 0) return null;

  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            {item.label}
          </dt>
          <dd className="text-lg font-medium">{item.value}</dd>
          <dd className="text-xs text-muted-foreground">{item.note}</dd>
        </div>
      ))}
    </dl>
  );
}
