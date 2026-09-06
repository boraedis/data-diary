import { notFound } from "next/navigation";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { RecapEntertainmentSection } from "@/components/recap/recap-entertainment-section";
import { RecapLifeEventsCard } from "@/components/recap/recap-life-events-card";
import { RecapPeoplePlacesSection } from "@/components/recap/recap-people-places-section";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { getRecapEntertainment } from "@/lib/recap-entertainment";
import { listRecapLifeEvents } from "@/lib/recap-life-events";
import { getRecapPeoplePlaces } from "@/lib/recap-people-places";
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
// What ships here is the frame plus the one stat the foundation itself can
// answer (how much of the year was logged at all). The four domain
// sections below are honest placeholders naming the sub-issue that fills
// each one in, following the same "scaffolding, not fake disabled controls"
// precedent as ChartPage's own filters placeholder.

/** The sections the report will grow, in the order #130 lists its v1
 * domains — declared here so the shell's shape is visible now and each
 * domain sub-issue is a fill-in rather than a layout negotiation. */
const PENDING_SECTIONS = [
  {
    title: "Mood & wellbeing",
    description: "Happiness trend and average, best and worst day, sleep, biggest-moving sub, longest good-day streak.",
    issue: 170,
  },
  {
    title: "Moments",
    description: "Automatically detected highs, lows and firsts.",
    issue: 174,
  },
] as const;

export default async function RecapYearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: segment } = await params;
  const year = parseYearSegment(segment);
  // A malformed segment 404s; a well-formed year with nothing logged
  // renders as an empty recap, because "you logged nothing in 2011" is a
  // true answer and a 404 isn't.
  if (year === null) notFound();

  const period = yearPeriod(year);
  const prior = previousPeriod(period);
  const [loggedDays, priorLoggedDays, entertainment, peoplePlaces, lifeEvents] = await Promise.all([
    countLoggedDays(period),
    countLoggedDays(prior),
    getRecapEntertainment(period, prior),
    getRecapPeoplePlaces(period, prior),
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

      <RecapLifeEventsCard events={lifeEvents} periodLabel={period.label} />

      {PENDING_SECTIONS.map((section) => (
        <ChartCard key={section.title} title={section.title} description={section.description}>
          <p className="py-6 text-center text-sm text-muted-foreground">
            Built in issue #{section.issue}.
          </p>
        </ChartCard>
      ))}
    </ChartPage>
  );
}
