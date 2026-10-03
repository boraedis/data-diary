import { RecapBodySection } from "@/components/recap/recap-body-section";
import { RecapEntertainmentSection } from "@/components/recap/recap-entertainment-section";
import { RecapHealthSection } from "@/components/recap/recap-health-section";
import { RecapLifeEventsCard } from "@/components/recap/recap-life-events-card";
import { RecapMomentsCard } from "@/components/recap/recap-moments-card";
import { RecapPeoplePlacesSection } from "@/components/recap/recap-people-places-section";
import { RecapStatCard } from "@/components/recap/recap-stat-card";
import { RecapStoryView } from "@/components/recap/recap-story";
import { RecapSubsSection } from "@/components/recap/recap-subs-section";
import { RecapWorkSection } from "@/components/recap/recap-work-section";
import { buildRecapStory } from "@/lib/recap-story";
import { getRecapBody } from "@/lib/recap-body";
import { getRecapEntertainment } from "@/lib/recap-entertainment";
import { isCompactChapter, type RecapChapter } from "@/lib/recap-chapters";
import { listRecapLifeEvents } from "@/lib/recap-life-events";
import { getRecapHealth } from "@/lib/recap-health";
import { getRecapMoments } from "@/lib/recap-moments";
import { getRecapPeoplePlaces } from "@/lib/recap-people-places";
import { getRecapSubs } from "@/lib/recap-subs";
import { getRecapWork } from "@/lib/recap-work";
import {
  MIN_DAYS_FOR_TOTAL,
  countLoggedDays,
  periodUnit,
  previousPeriod,
  toRecapStat,
  type RecapPeriod,
} from "@/lib/recap";

// Both tiers #130 settled on, in the order it settled on them: the story
// (#175) up front, the detailed report (#169) expandable underneath it —
// for any period. Lifted out of the year page when #176 added months, so
// both routes are thin wrappers that pick a period and its navigation.
//
// The split of responsibilities is the point. This component does all the
// fetching and composes the report out of the same section components it
// always did — `RecapStoryView` is a client wrapper that takes the
// already-server-rendered report as `children`, so expanding it costs no
// refetch and the report is identical whether or not a story sits above it.
// Which cards the story is made of is decided by `buildRecapStory`, a pure
// function with its own tests; a period too sparse to earn one gets an
// empty list back and the view opens straight into the report.
//
// Each section owns its own empty and insufficient-data states rather than
// being conditionally rendered here — a period with nothing logged should
// still show its sections saying so.
//
// **The month card set (#176).** #176 asked for the card set to be
// re-scoped for a month rather than inherited wholesale. Every fetcher is
// shared unchanged — none of their signatures moved — and what differs is
// what gets shown from their output:
//
// - The story deals at most five cards and never the sub mover (see
//   `MAX_MONTH_STORY_CARDS` and `YEAR_ONLY_CARD_IDS` in recap-story.ts).
// - Subs keep their per-sub averages but drop "most improved / biggest
//   increase": month over month, that's a few days either side.
// - People & places drops the travel map. A month's footprint is usually
//   one country, and a world map with one tinted shape says less than the
//   "countries visited" count beside it. The place leaderboard stays — it's
//   the most direct answer to "where did I spend this month".
// - Life events drop entries that simply ran through the whole period.
//   Over a year, "current job: all year" is part of the picture; repeated
//   on every one of twelve months it's the same three rows each time, and
//   the interesting month — the one something started or ended — gets
//   buried in them.
//
// Health, body & habits, work & screen time (#530), entertainment and
// moments carry over whole. Their averages are
// already held to `MIN_DAYS_FOR_AVERAGE` (14 days), which a well-logged
// month clears and a sparse one honestly doesn't; moments are scored
// against the all-time distribution, so a month surfaces its own few
// without any threshold changing.
//
// **Chapters (#519).** A life chapter is passed as `chapter` alongside its
// period. Still no fetcher changes; three display decisions differ:
//
// - It's named as a chapter, not by calendar unit — read from the prop, not
//   from `periodUnit`, which would call a chapter that happens to run
//   January 1 to December 31 a year.
// - A short chapter (`isCompactChapter`) gets the month's trimmed set
//   above; a long one gets the year's. Length, not kind, is what decides
//   how much a chapter can honestly say.
// - Life events drop the chapter's own entry — "Started Acme" inside the
//   recap of Acme is the chapter describing itself — and keep everything
//   else that overlapped it, *including* entries that ran throughout. At
//   chapter scope those are the point: which home this job was lived from,
//   which job this relationship ran alongside. (A role chapter keeps its
//   job, for the same reason.)

export async function RecapReport({
  period,
  chapter,
}: {
  period: RecapPeriod;
  chapter?: RecapChapter;
}) {
  const unit = chapter ? "chapter" : periodUnit(period);
  const isMonth = unit === "month";
  const compact = isMonth || (chapter !== undefined && isCompactChapter(period));
  const prior = previousPeriod(period);
  const [
    loggedDays,
    priorLoggedDays,
    entertainment,
    peoplePlaces,
    subs,
    health,
    body,
    { work, screenTime },
    moments,
    allLifeEvents,
  ] = await Promise.all([
    countLoggedDays(period),
    countLoggedDays(prior),
    getRecapEntertainment(period, prior),
    getRecapPeoplePlaces(period, prior),
    getRecapSubs(period, prior),
    getRecapHealth(period, prior),
    getRecapBody(period, prior),
    getRecapWork(period, prior),
    getRecapMoments(period),
    listRecapLifeEvents(period),
  ]);

  const lifeEvents = chapter
    ? allLifeEvents.filter((event) => event.key !== chapter.key)
    : isMonth
      ? allLifeEvents.filter((event) => event.framing !== "throughout")
      : allLifeEvents;

  const daysLogged = toRecapStat({
    value: loggedDays,
    loggedDays,
    requiredDays: MIN_DAYS_FOR_TOTAL,
    prior: priorLoggedDays,
    priorLoggedDays,
  });

  const story = buildRecapStory({
    periodLabel: period.label,
    periodUnit: unit,
    compact,
    priorLabel: prior.label,
    loggedDays,
    priorLoggedDays,
    health,
    body,
    work,
    screenTime,
    entertainment,
    peoplePlaces,
    subs,
    moments,
    lifeEvents,
  });

  return (
    <RecapStoryView cards={story} periodLabel={period.label}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RecapStatCard label="Days logged" stat={daysLogged} priorLabel={prior.label} />
      </div>

      <RecapHealthSection health={health} periodLabel={period.label} priorLabel={prior.label} />

      <RecapBodySection body={body} periodLabel={period.label} priorLabel={prior.label} />

      <RecapWorkSection
        work={work}
        screenTime={screenTime}
        periodLabel={period.label}
        priorLabel={prior.label}
      />

      <RecapSubsSection
        subs={subs}
        periodLabel={period.label}
        priorLabel={prior.label}
        showMovers={!compact}
      />

      <RecapEntertainmentSection
        entertainment={entertainment}
        periodLabel={period.label}
        priorLabel={prior.label}
      />

      <RecapPeoplePlacesSection
        data={peoplePlaces}
        periodLabel={period.label}
        priorLabel={prior.label}
        showMap={!compact}
      />

      <RecapMomentsCard moments={moments} periodLabel={period.label} />

      <RecapLifeEventsCard
        events={lifeEvents}
        periodLabel={period.label}
        periodNoun={unit ?? "period"}
        throughoutLabel={chapter ? "Throughout" : undefined}
        description={
          chapter
            ? `The other jobs, homes and relationships that overlapped ${period.label}.`
            : isMonth
              ? `Jobs, homes and relationships that started or ended in ${period.label}.`
              : undefined
        }
      />
    </RecapStoryView>
  );
}
