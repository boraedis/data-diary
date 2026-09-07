import { notFound } from "next/navigation";
import { ChartPage } from "@/components/charts/chart-page";
import { RecapEntertainmentSection } from "@/components/recap/recap-entertainment-section";
import { RecapHealthSection } from "@/components/recap/recap-health-section";
import { RecapLifeEventsCard } from "@/components/recap/recap-life-events-card";
import { RecapMomentsCard } from "@/components/recap/recap-moments-card";
import { RecapPeoplePlacesSection } from "@/components/recap/recap-people-places-section";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { RecapSubsSection } from "@/components/recap/recap-subs-section";
import { getRecapEntertainment } from "@/lib/recap-entertainment";
import { listRecapLifeEvents } from "@/lib/recap-life-events";
import { getRecapHealth } from "@/lib/recap-health";
import { getRecapMoments } from "@/lib/recap-moments";
import { getRecapPeoplePlaces } from "@/lib/recap-people-places";
import { getRecapSubs } from "@/lib/recap-subs";
import {
  MIN_DAYS_FOR_TOTAL,
  countLoggedDays,
  parseYearSegment,
  previousPeriod,
  toRecapStat,
  yearPeriod,
} from "@/lib/recap";

export const dynamic = "force-dynamic";

// The detailed recap report (issue #169, epic #130) — the second of the
// two tiers #130 settled on, and the one that reuses this app's existing
// page chrome rather than inventing any. The story tier (#175) is the only
// genuinely new surface in the epic and is not part of this shell.
//
// Every section is now real: health (#201), subs (#170), entertainment
// (#171), people & places (#172), moments (#174) and life events (#173).
// The page is a composition of them plus the one stat the foundation
// answers itself, and each section owns its own empty and
// insufficient-data states rather than being conditionally rendered here —
// a year with nothing logged should still show its sections saying so.

export default async function RecapYearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: segment } = await params;
  const year = parseYearSegment(segment);
  // A malformed segment 404s; a well-formed year with nothing logged
  // renders as an empty recap, because "you logged nothing in 2011" is a
  // true answer and a 404 isn't.
  if (year === null) notFound();

  const period = yearPeriod(year);
  const prior = previousPeriod(period);
  const [
    loggedDays,
    priorLoggedDays,
    entertainment,
    peoplePlaces,
    subs,
    health,
    moments,
    lifeEvents,
  ] = await Promise.all([
    countLoggedDays(period),
    countLoggedDays(prior),
    getRecapEntertainment(period, prior),
    getRecapPeoplePlaces(period, prior),
    getRecapSubs(period, prior),
    getRecapHealth(period, prior),
    getRecapMoments(period),
    listRecapLifeEvents(period),
  ]);

  const daysLogged = toRecapStat({
    value: loggedDays,
    loggedDays,
    requiredDays: MIN_DAYS_FOR_TOTAL,
    prior: priorLoggedDays,
    priorLoggedDays,
  });

  return (
    <ChartPage title={`Recap ${period.label}`} backHref="/recap" backLabel="Recap" filters={null}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RecapStatCard label="Days logged" stat={daysLogged} priorLabel={prior.label} />
      </div>

      <RecapHealthSection health={health} periodLabel={period.label} priorLabel={prior.label} />

      <RecapSubsSection subs={subs} periodLabel={period.label} priorLabel={prior.label} />

      <RecapEntertainmentSection
        entertainment={entertainment}
        periodLabel={period.label}
        priorLabel={prior.label}
      />

      <RecapPeoplePlacesSection
        data={peoplePlaces}
        periodLabel={period.label}
        priorLabel={prior.label}
      />

      <RecapMomentsCard moments={moments} periodLabel={period.label} />

      <RecapLifeEventsCard events={lifeEvents} periodLabel={period.label} />
    </ChartPage>
  );
}
