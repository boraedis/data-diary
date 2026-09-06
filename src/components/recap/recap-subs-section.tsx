import { ChartCard } from "@/components/charts/chart-card";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { MIN_DAYS_FOR_AVERAGE, toRecapStat } from "@/lib/recap";
import type { RecapSubMover, RecapSubs, RecapSubSummary } from "@/lib/recap-subs";

// The subs section of the recap report (issue #170, epic #130).
//
// For these, less is better — so unlike every other section in this report
// the copy takes a side: a sub whose average fell is "most improved", and
// the mover cards name the direction rather than reporting a neutral
// delta. See the module header in `src/lib/recap-subs.ts` for why that's
// said in words and not in color.
//
// This is also the first consumer of the foundation's
// `MIN_DAYS_FOR_AVERAGE`. Every other section reports totals, which are
// honest at any coverage; an average over four logged days is not, which is
// exactly the distinction that constant was introduced for in #179.

/** One decimal: these are 0-10 daily scores, so an average of 3.2 says
 * something 3 doesn't, and 3.18 says nothing 3.2 doesn't. */
function formatAverage(value: number): string {
  return value.toFixed(1);
}

export function RecapSubsSection({
  subs,
  periodLabel,
  priorLabel,
}: {
  subs: RecapSubs;
  periodLabel: string;
  priorLabel: string;
}) {
  return (
    <ChartCard
      title="Subs"
      description={`Average daily score for each tracked sub in ${periodLabel} — lower is better.`}
      empty={subs.daysWithSubData === 0}
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subs.summaries.map((summary) => (
            <SubCard key={summary.name} summary={summary} priorLabel={priorLabel} />
          ))}
        </div>

        <Movers
          mostImproved={subs.mostImproved}
          biggestIncrease={subs.biggestIncrease}
          priorLabel={priorLabel}
        />
      </div>
    </ChartCard>
  );
}

function SubCard({ summary, priorLabel }: { summary: RecapSubSummary; priorLabel: string }) {
  return (
    <RecapStatCard
      label={summary.name}
      // "Ni" is not "NI", and "Ad" is not "AD" — the sub names carry their
      // own capitalization, so the card's small-caps treatment is off here.
      preserveLabelCase
      unit="avg / day"
      format={formatAverage}
      priorLabel={priorLabel}
      stat={toRecapStat({
        // `?? 0` never reaches the card as a real value: a null average
        // means nothing was logged, which is also zero logged days, so the
        // coverage rule below returns the insufficient state first.
        value: summary.average ?? 0,
        loggedDays: summary.daysLogged,
        requiredDays: MIN_DAYS_FOR_AVERAGE,
        prior: summary.priorAverage,
        priorLoggedDays: summary.priorDaysLogged,
      })}
    />
  );
}

function Movers({
  mostImproved,
  biggestIncrease,
  priorLabel,
}: {
  mostImproved: RecapSubMover | null;
  biggestIncrease: RecapSubMover | null;
  priorLabel: string;
}) {
  if (!mostImproved && !biggestIncrease) return null;

  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {mostImproved ? (
        <Mover label="Most improved" mover={mostImproved} direction="lower" priorLabel={priorLabel} />
      ) : null}
      {biggestIncrease ? (
        <Mover label="Biggest increase" mover={biggestIncrease} direction="higher" priorLabel={priorLabel} />
      ) : null}
    </dl>
  );
}

function Mover({
  label,
  mover,
  direction,
  priorLabel,
}: {
  label: string;
  mover: RecapSubMover;
  direction: "lower" | "higher";
  priorLabel: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{label}</dt>
      <dd className="text-lg font-medium">{mover.name}</dd>
      <dd className="text-xs text-muted-foreground">
        {formatAverage(Math.abs(mover.change))} {direction} than {priorLabel} (
        {formatAverage(mover.priorAverage)} → {formatAverage(mover.average)})
      </dd>
    </div>
  );
}
