import { ChartCard } from "@/components/charts/chart-card";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { formatDate } from "@/lib/viz/format";
import { MIN_DAYS_FOR_TOTAL, toRecapStat } from "@/lib/recap";
import type { RecapSubMover, RecapSubs, RecapSubSummary } from "@/lib/recap-subs";

// The subs section of the recap report (issue #170, epic #130).
//
// For these nine, less is better — so unlike every other section in this
// report, the copy here takes a side. A sub that happened on fewer days is
// "most improved", a run of zero days is a streak worth naming, and the
// per-sub rows say "fewer"/"more" rather than a neutral delta. See the
// module header in `src/lib/recap-subs.ts` for why that direction is
// stated in words and not in color.

export function RecapSubsSection({
  subs,
  periodLabel,
  priorLabel,
}: {
  subs: RecapSubs;
  periodLabel: string;
  priorLabel: string;
}) {
  const tracked = subs.summaries.filter((s) => s.daysLogged > 0 || s.priorDaysLogged > 0);

  return (
    <ChartCard
      title="Subs"
      description={`How the nine tracked subs went in ${periodLabel}. Fewer days is better.`}
      empty={subs.daysWithSubData === 0}
    >
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <RecapStatCard
            label="Clean days"
            unit="days"
            priorLabel={priorLabel}
            stat={toRecapStat({
              value: subs.cleanDays.total,
              // Coverage is days with sub data, not the clean count itself:
              // zero clean days in a well-logged year is a real answer,
              // where zero in a year with no sub data at all is not.
              loggedDays: subs.daysWithSubData,
              requiredDays: MIN_DAYS_FOR_TOTAL,
              prior: subs.cleanDays.priorTotal,
              priorLoggedDays: subs.priorDaysWithSubData,
            })}
          />
          <StreakCard streak={subs.longestCleanStreak} hasData={subs.daysWithSubData > 0} />
          <RecapStatCard
            label="Days tracked"
            unit="days"
            priorLabel={priorLabel}
            stat={toRecapStat({
              value: subs.daysWithSubData,
              loggedDays: subs.daysWithSubData,
              requiredDays: MIN_DAYS_FOR_TOTAL,
              prior: subs.priorDaysWithSubData,
              priorLoggedDays: subs.priorDaysWithSubData,
            })}
          />
        </div>

        <Movers mostImproved={subs.mostImproved} biggestIncrease={subs.biggestIncrease} priorLabel={priorLabel} />

        {tracked.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Days with each
            </h3>
            <ul className="flex flex-col">
              {tracked.map((summary) => (
                <SubRow key={summary.name} summary={summary} priorLabel={priorLabel} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </ChartCard>
  );
}

/** The streak gets its own card rather than a plain stat because the number
 * alone ("23") means nothing without the run it refers to. */
function StreakCard({
  streak,
  hasData,
}: {
  streak: RecapSubs["longestCleanStreak"];
  hasData: boolean;
}) {
  return (
    <div className="flex h-full flex-col gap-1 rounded-xl border bg-card px-6 py-5">
      <span className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
        Longest clean streak
      </span>
      {streak.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          {hasData ? "No fully clean day this period." : "Nothing tracked this period."}
        </p>
      ) : (
        <>
          <p className="flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold md:text-4xl">{streak.length}</span>
            <span className="text-sm text-muted-foreground">
              day{streak.length === 1 ? "" : "s"}
            </span>
          </p>
          {streak.start && streak.end ? (
            <p className="text-xs text-muted-foreground">
              {streak.length === 1
                ? formatDate(streak.start)
                : `${formatDate(streak.start)} – ${formatDate(streak.end)}`}
            </p>
          ) : null}
        </>
      )}
    </div>
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
        <Mover
          label="Most improved"
          mover={mostImproved}
          sentence={`${Math.abs(mostImproved.change)} fewer days than ${priorLabel}`}
        />
      ) : null}
      {biggestIncrease ? (
        <Mover
          label="Biggest increase"
          mover={biggestIncrease}
          sentence={`${biggestIncrease.change} more days than ${priorLabel}`}
        />
      ) : null}
    </dl>
  );
}

function Mover({
  label,
  mover,
  sentence,
}: {
  label: string;
  mover: RecapSubMover;
  sentence: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium tracking-widest text-muted-foreground uppercase">{label}</dt>
      <dd className="text-lg font-medium">{mover.name}</dd>
      <dd className="text-xs text-muted-foreground">
        {sentence} ({mover.priorDaysWithAny} → {mover.daysWithAny})
      </dd>
    </div>
  );
}

function SubRow({ summary, priorLabel }: { summary: RecapSubSummary; priorLabel: string }) {
  const change = summary.daysWithAny - summary.priorDaysWithAny;
  // No comparison unless both periods actually logged this sub — see the
  // "mover" note in recap-subs.ts: a drop caused by not tracking any more
  // isn't an improvement.
  const comparable = summary.daysLogged > 0 && summary.priorDaysLogged > 0;

  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-border/60 py-2 last:border-0">
      <span className="text-sm font-medium">{summary.name}</span>
      <span className="flex items-baseline gap-2 text-right">
        <span className="text-sm tabular-nums">{summary.daysWithAny}</span>
        <span className="w-28 text-xs text-muted-foreground">
          {!comparable
            ? "no comparison"
            : change === 0
              ? `same as ${priorLabel}`
              : `${Math.abs(change)} ${change < 0 ? "fewer" : "more"} than ${priorLabel}`}
        </span>
      </span>
    </li>
  );
}
