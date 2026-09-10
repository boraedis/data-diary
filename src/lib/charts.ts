import { asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { days, exercises, people, places, tags, workouts } from "@/db/schema";
import { groupByPeriod, summarizePeriods } from "@/lib/viz/bin";
import { normalizeCountryName } from "@/lib/geo/country-names";
import { resolveUsStateName, US_STATE_FIPS_BY_NAME } from "@/lib/geo/us-state-names";
import { resolveCountyForPoint, type UsCounty } from "@/lib/geo/us-counties";
import { CITIES, type CityKey } from "@/lib/geo/city-config";
import { resolveCityFeatureName, isPlaceInCity } from "@/lib/geo/resolve-city-place";
import atlantaTopo from "@/data/geo/atlanta.topo.json";
import dcMetroTopo from "@/data/geo/dc-metro.topo.json";
import dubaiTopo from "@/data/geo/dubai.topo.json";
import nycTopo from "@/data/geo/nyc.topo.json";
import istanbulTopo from "@/data/geo/istanbul.topo.json";
import { addDays, parseDate } from "@/lib/date";
import { getProfileSettings, listProfileOccupations, listProfileRelationships, listProfileResidences } from "@/lib/profile";
import type { InteractiveScrollerRegion } from "@/components/charts/interactive/interactive-scroller";
import type { TimelineInterval } from "@/lib/viz/timeline";

// Phase 4, first batch: five chart data-fetchers, each backed entirely by
// domains already migrated (Phases 1-3) — see REBUILD_PLAN.md for the full
// list of legacy charts and why these five were picked first (data-ready,
// and five genuinely different D3 chart archetypes). Every function returns
// plain serializable data (no Date objects, no Drizzle row wrappers) since
// it's passed from a server component straight into a client chart
// component as a prop.

// --- Happiness histogram ---------------------------------------------------

/** Every recorded happiness value (0-100), oldest first. Binning is left to
 * the chart component (d3.bin has better judgment about bucket width than a
 * pre-aggregated count would) rather than done here. */
export async function getHappinessHistogramData(): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({ happiness: days.happiness })
    .from(days)
    .where(isNotNull(days.happiness))
    .orderBy(asc(days.date));
  return rows.map((r) => r.happiness as number);
}

// --- Happiness scroller ---------------------------------------------------

// `reason` included (unlike the public version in public-charts.ts) — it's
// per-day free text, which the public landing page's own locked-in rules
// (issue #12) permanently exclude, so this type/function stays
// private-only. Powers InteractiveScroller's point-label feature (issue
// #117 follow-up).
export type HappinessScrollerPoint = { date: string; happiness: number; reason: string | null };

/** Every recorded happiness value, oldest first — the raw-daily-density
 * counterpart to getHappinessAveragerData's monthly bucketing below,
 * feeding InteractiveScroller the same way getWeightScrollerData does for
 * weight (issue #117 follow-up). */
export async function getHappinessScrollerData(): Promise<HappinessScrollerPoint[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, happiness: days.happiness, reason: days.happinessReason })
    .from(days)
    .where(isNotNull(days.happiness))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ date: r.date, happiness: r.happiness as number, reason: r.reason }));
}

// --- Weight scroller ---------------------------------------------------

// Widened from a single weightKg field (issue #117 follow-up: "multi
// select between 3 weight fields... visualize all on the same y scale") —
// each field is independently nullable since they're logged separately
// (a day can have weight without body fat/muscle mass, or vice versa).
export type WeightMetricsPoint = {
  date: string;
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
};

/** Every day with at least one of weight/body fat/muscle mass recorded,
 * oldest first — feeds InteractiveScroller's multi-series zoomable chart
 * (issue #117). */
export async function getWeightScrollerData(): Promise<WeightMetricsPoint[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, weightKg: days.weightKg, bodyFatPercent: days.bodyFatPercent, muscleMassKg: days.muscleMassKg })
    .from(days)
    .where(or(isNotNull(days.weightKg), isNotNull(days.bodyFatPercent), isNotNull(days.muscleMassKg)))
    .orderBy(asc(days.date));
  return rows;
}

// Legacy's own fixed 7-color wheel for age bands (vis_functions.js:3294,
// `ageRegions()`'s COLOR_WHEEL), cycled by `age % length` — explicitly
// requested to carry this forward as-is rather than leaving age bands
// uncolored. A deliberate, named exception to the categorical palette's
// own "never cycle" rule the same way --metric-weight is: age bands are
// ordinal (there's no fixed "5 real categories" here, potentially decades
// of them), so cycling through a fixed rainbow and repeating is the only
// way to give every band *some* color at all — it reads as "these are
// different bands," not as "these are 7 comparable categories" the way
// chart-1..5 does.
const AGE_COLOR_WHEEL = ["#5F0F40", "#9A031E", "#E36414", "#C7BA25", "#518241", "#0F4C5C", "#242964"];

/** One age-year band per birthday-to-birthday span, from birth to `until`
 * — the real-birthdate equivalent of legacy's `ageRegions()`
 * (vis_functions.js:3289), which instead hardcoded a fixed March 20 cutoff;
 * this schema has a real `profileSettings.birthdate` to compute the actual
 * cutoff from instead. Exported for testability. */
export function computeAgeRegions(birthdate: string, until: Date): InteractiveScrollerRegion[] {
  const birth = parseDate(birthdate);
  const regions: InteractiveScrollerRegion[] = [];
  let age = 0;
  let start = birth;
  while (start < until) {
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    regions.push({
      start,
      end: end > until ? until : end,
      label: `Age ${age}`,
      color: AGE_COLOR_WHEEL[age % AGE_COLOR_WHEEL.length],
    });
    start = end;
    age++;
  }
  return regions;
}

// Generic across every InteractiveScroller chart, not weight-specific
// (renamed from WeightChartRegionGroups once the happiness scroller became
// a second real consumer of the exact same four region types — same
// "generalize once there's a real second use" call this schema already
// makes elsewhere).
export type ProfileRegionGroups = {
  age: InteractiveScrollerRegion[];
  occupation: InteractiveScrollerRegion[];
  residence: InteractiveScrollerRegion[];
  relationship: InteractiveScrollerRegion[];
};

/** Occupation/residence/relationship timelines, reusing src/lib/profile.ts's
 * existing list functions rather than re-querying those tables — each
 * entry's own `color` (set via the profile admin UI) carries straight
 * through; `alias` wins over the full `name` as the on-chart label when
 * present (the shorter of the two, meant for exactly this kind of
 * space-constrained display). An open-ended entry's `end` becomes `until`
 * (today, typically) rather than left unbounded, since a region needs a
 * real right edge to render. Private-only (issue #117's own follow-up
 * note) — never call this from src/lib/public-charts.ts. */
export async function getProfileRegionGroups(until: Date = new Date()): Promise<ProfileRegionGroups> {
  const [settings, occupations, residences, relationships] = await Promise.all([
    getProfileSettings(),
    listProfileOccupations(),
    listProfileResidences(),
    listProfileRelationships(),
  ]);

  function toRegion(item: { name: string; alias: string | null; start: string; end: string | null; color: string | null }): InteractiveScrollerRegion {
    return {
      start: parseDate(item.start),
      end: item.end ? parseDate(item.end) : until,
      label: item.alias ?? item.name,
      color: item.color ?? undefined,
    };
  }

  return {
    age: settings.birthdate ? computeAgeRegions(settings.birthdate, until) : [],
    occupation: occupations.map(toRegion),
    residence: residences.map(toRegion),
    relationship: relationships.map(toRegion),
  };
}

/** A profile timeline entry, plus the colour set for it in the profile
 * admin UI (null when none was chosen).
 *
 * `color` rides alongside `TimelineInterval` rather than being added to it:
 * `InteractiveTimeline` already takes colour as a prop-level function, so
 * putting a colour field on the primitive's own input type would give it
 * two competing sources of truth for the same decision. The chart builds a
 * lookup from these and answers through that function instead. */
export type LifeTimelineEntry = TimelineInterval & { color: string | null };

/** The same three profile timelines as `getProfileRegionGroups` above, in
 * `InteractiveTimeline`'s shape instead of `InteractiveScroller`'s — the
 * life-timeline chart (#310).
 *
 * A sibling of that function rather than a reuse of it, for two reasons
 * worth stating since the two now sit next to each other reading almost
 * identically:
 *
 *  1. **`end: null` survives here.** A scroller region is a background
 *     band and needs a real right edge, so that function resolves an
 *     open-ended entry to `until` (today). This chart's whole subject is
 *     the intervals themselves, and `InteractiveTimeline` draws "still
 *     ongoing" differently from "ended today" — collapsing it would be
 *     throwing away the distinction the chart exists to show.
 *  2. **Regions never overlap-stack.** They're chrome painted behind a
 *     series; two overlapping jobs just paint over each other. Here the
 *     intervals are the data, so they go through `layoutTimeline`'s
 *     sub-lane stacking, which needs the raw interval, not a resolved band.
 *
 * Ids are prefixed per lane because the three tables have independent
 * `serial` primary keys — occupation 1 and residence 1 both exist, and the
 * timeline keys its marks by id across the whole chart.
 *
 * `alias ?? name` for the label, matching `getProfileRegionGroups` — alias
 * is the short form meant for exactly this kind of space-constrained
 * display.
 *
 * Private-only, same as `getProfileRegionGroups`: the relationship
 * timeline is permanently excluded from the public site (see AGENTS.md's
 * #12 boundary). Never call this from src/lib/public-charts.ts. */
export async function getLifeTimelineData(): Promise<LifeTimelineEntry[]> {
  const [occupations, residences, relationships] = await Promise.all([
    listProfileOccupations(),
    listProfileResidences(),
    listProfileRelationships(),
  ]);

  type Entry = {
    id: number;
    name: string;
    alias: string | null;
    start: string;
    end: string | null;
    color: string | null;
  };
  const toInterval = (lane: string, prefix: string) => (item: Entry): LifeTimelineEntry => ({
    id: `${prefix}-${item.id}`,
    lane,
    label: item.alias ?? item.name,
    start: item.start,
    end: item.end,
    color: item.color,
  });

  // Emitted in this order deliberately: `layoutTimeline` orders lanes by
  // first appearance, so this array's order *is* the y-axis order. Work
  // first, then where you lived, then who with — roughly outermost to most
  // personal, and the same order the profile page lists them in.
  return [
    ...occupations.map(toInterval("Occupation", "occupation")),
    ...residences.map(toInterval("Residence", "residence")),
    ...relationships.map(toInterval("Relationship", "relationship")),
  ];
}

// --- Sleep calendar ---------------------------------------------------

export type SleepDay = { date: string; durationMinutes: number };

/**
 * A night plus where it was spent — the private-only superset of `SleepDay`.
 *
 * Kept as its own type rather than widening `SleepDay`, because `SleepDay`
 * is what the **public** sleep chart renders
 * (`src/lib/public-charts.ts` -> `/public-charts/sleep`). Adding a field
 * there would have quietly required the public data layer to supply where
 * the user sleeps — precisely the leak the boundary in AGENTS.md exists to
 * stop, and the sort that arrives by type inference rather than by anyone
 * deciding it. The narrow type stays narrow; only private callers see this
 * one.
 */
export type SleepNight = SleepDay & {
  /** `days.sleepLocationType`, or null when it wasn't recorded — which is
   * most nights, so anything grouping on this must treat null as its own
   * group rather than dropping it. */
  locationType: string | null;
};

function hhmmToMinutes(hhmm: string): number | null {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Sleep duration per day, derived from sleepTime/wakeTime + the explicit
 * wakeCrossedMidnight flag (see schema.ts's comment on that column — the
 * legacy app computed this client-side and then discarded it, so duration
 * across midnight is only recoverable going forward, not for old data that
 * predates the flag... except the flag is backfilled by the Phase 3
 * migration script from the same wake<sleep heuristic, so it's populated
 * for historical data too). Days missing either time are skipped rather
 * than guessed at. */
export async function getSleepCalendarData(): Promise<SleepDay[]> {
  const nights = await getSleepNightsData();
  return nights.map(({ date, durationMinutes }) => ({ date, durationMinutes }));
}

/** The same derivation, keeping the sleep location. Private callers only —
 * see `SleepNight`. */
export async function getSleepNightsData(): Promise<SleepNight[]> {
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
      sleepTime: days.sleepTime,
      wakeTime: days.wakeTime,
      wakeCrossedMidnight: days.wakeCrossedMidnight,
      locationType: days.sleepLocationType,
    })
    .from(days)
    .where(sql`${days.sleepTime} is not null and ${days.wakeTime} is not null`)
    .orderBy(asc(days.date));

  const out: SleepNight[] = [];
  for (const r of rows) {
    const sleepMin = hhmmToMinutes(r.sleepTime as string);
    const wakeMin = hhmmToMinutes(r.wakeTime as string);
    if (sleepMin === null || wakeMin === null) continue;
    const durationMinutes = wakeMin - sleepMin + (r.wakeCrossedMidnight ? 24 * 60 : 0);
    if (durationMinutes <= 0 || durationMinutes > 20 * 60) continue; // guard against bad data
    out.push({ date: r.date, durationMinutes, locationType: r.locationType });
  }
  return out;
}

// --- Weight + workout volume combo ---------------------------------------------------

export type WorkoutMonth = { month: string; count: number }; // month = "YYYY-MM"

// Plain {date, weightKg} — this combo chart only ever needed the one
// field, unlike WeightMetricsPoint above (widened for the scroller's
// multi-field #117 follow-up); kept separate rather than reusing that
// wider type so this chart doesn't have to deal with fields it never
// plots.
export type WeightPoint = { date: string; weightKg: number };

export type GymWeightComboData = {
  weight: WeightPoint[];
  workoutsByMonth: WorkoutMonth[];
};

/** Weight (line) alongside workout frequency (bars, one per calendar month —
 * daily workout counts would be too sparse/spiky to read as bars over a
 * multi-year range, monthly is the legacy chart's effective resolution
 * too). Two independently-shaped series sharing one time x-axis and two
 * y-axes, ported from the legacy app's bespoke `LineBarChart` in
 * gym-weight_chart.js. */
export async function getGymWeightComboData(): Promise<GymWeightComboData> {
  const db = getDb();
  const [weightRows, workoutDates] = await Promise.all([
    db
      .select({ date: days.date, weightKg: days.weightKg })
      .from(days)
      .where(isNotNull(days.weightKg))
      .orderBy(asc(days.date)),
    db.select({ date: workouts.date }).from(workouts).orderBy(asc(workouts.date)),
  ]);

  // Monthly bucketing via the shared groupByPeriod helper (#16) — this
  // used to be its own hand-rolled `Map<string, number>` here, duplicating
  // the same "bucket by month" logic getHappinessAveragerData had below.
  const workoutsByMonth = groupByPeriod(workoutDates, "month", (r) => r.date).map(({ key, items }) => ({
    month: key,
    count: items.length,
  }));

  return {
    weight: weightRows.map((r) => ({ date: r.date, weightKg: r.weightKg as number })),
    workoutsByMonth,
  };
}

// --- Exercise mix (#19's InteractiveArea proving case) -------------------

// Fixed order matching exerciseCategoryEnum's own declared order
// (src/db/schema.ts) — color-follows-the-entity depends on every consumer
// (InteractiveArea's default categoricalColor(i)) agreeing on one order,
// not each re-deriving it from whatever order rows happen to come back
// from the DB in.
export const EXERCISE_CATEGORY_LABELS: Record<string, string> = {
  distance: "Distance",
  sport: "Sport",
  strength: "Strength",
};
export const EXERCISE_CATEGORY_ORDER = ["distance", "sport", "strength"] as const;

export type ExerciseWorkoutRow = {
  date: string;
  category: string;
  exerciseId: number;
  exerciseName: string;
  /** Equipment/variant free text (workouts.subtype — see that column's
   * own schema comment); null when never filled in. NOT the same thing
   * as the exerciseSubtypes catalog table, which workouts.subtype isn't
   * actually linked to yet (also see that comment). */
  subtype: string | null;
};

/** Every workout on record, oldest first, with its exercise's category and
 * name joined in. Deliberately raw/unaggregated rather than pre-bucketed
 * by month the way this used to be shaped: #19's period/range/group-by
 * controls all need to re-derive the chart's points reactively (a
 * different bucket width, a narrower date range, a different grouping
 * dimension), and viz/bin.ts's own architecture note is exactly this case
 * — client-side re-bucketing of a series that's cheap to hold raw, not a
 * server round-trip per control change. This app's workout volume is
 * small enough (personal habit tracking, not a firehose) that shipping
 * every row to the client is the right tradeoff over a query per filter
 * change. Chart components re-derive whatever bucketed/grouped shape they
 * need (see exercise-mix-explorer.tsx) rather than this function doing it
 * for them. */
export async function getExerciseWorkoutRows(): Promise<ExerciseWorkoutRow[]> {
  const db = getDb();
  return db
    .select({
      date: workouts.date,
      category: exercises.category,
      exerciseId: exercises.id,
      exerciseName: exercises.name,
      subtype: workouts.subtype,
    })
    .from(workouts)
    .innerJoin(exercises, eq(workouts.exerciseId, exercises.id))
    .orderBy(asc(workouts.date));
}

// --- Place leaderboard ---------------------------------------------------

export type PlaceLeaderboardEntry = { name: string; value: number; color: string | null };

// places.color is only ever set on a top-level ("country") place — see
// that column's own comment in schema.ts — so a leaf place's own "country
// color" is its root ancestor's color, not its own. idPath is
// "<id>/<id>/.../<id>/" from root to self inclusive (schema.ts), so the
// root's id is always the first segment; self-joining places against that
// gives the root row (and, for a place that's already a root, joins back
// to itself). Left-joined and nullable throughout: idPath is null until
// backfilled (see schema.ts), and a root place may simply have no color
// set — both cases fall back to the toolkit default at the call site
// rather than here, matching getPeopleNetworkData's own tag-color
// convention just above.
const rootPlaces = alias(places, "root_places");

/** Ranks places by how often they were logged in a day's two place slots,
 * weighting slot 1 double slot 2 — the exact scheme the legacy
 * `location_leaderboard` chart used (`places[mens.place1].value += 2`,
 * `+= 1` for place2). The legacy chart then grouped results into a
 * metro/category hierarchy for a nested table; that enrichment isn't in
 * this schema yet (see REBUILD_PLAN.md), so this is the flat top-N
 * ranking underneath it — still the real, meaningful part. */
export async function getPlaceLeaderboardData(limit = 30): Promise<PlaceLeaderboardEntry[]> {
  const db = getDb();
  const rows = await db
    .select({
      name: places.name,
      value: sql<number>`
        coalesce(sum(case when ${days.place1Id} = ${places.id} then 2 else 0 end), 0)
        + coalesce(sum(case when ${days.place2Id} = ${places.id} then 1 else 0 end), 0)
      `.as("value"),
      color: rootPlaces.color,
    })
    .from(places)
    .innerJoin(
      days,
      sql`${days.place1Id} = ${places.id} or ${days.place2Id} = ${places.id}`,
    )
    .leftJoin(rootPlaces, sql`${rootPlaces.id} = nullif(split_part(${places.idPath}, '/', 1), '')::int`)
    .groupBy(places.id, places.name, rootPlaces.color)
    .orderBy(desc(sql`value`))
    .limit(limit);

  return rows.map((r) => ({ name: r.name, value: Number(r.value), color: r.color }));
}

// --- Happiness averager ---------------------------------------------------

export type MonthlyAverage = {
  month: string; // "YYYY-MM"
  avg: number;
  count: number;
  /** Lowest/highest single day within the month — the legacy "Averager"
   * pattern's min/max band (functions/views/vis/vis_functions.js's
   * Averager), showing how much a month's days actually varied around its
   * average rather than just the average alone. Wired into a shaded band
   * behind the line by HappinessAveragerChart (#18); see
   * interactive-line.tsx's `band` series option. */
  min: number;
  max: number;
};

/** Monthly average happiness (plus the sample size behind each point, so the
 * chart can size markers by how many days actually fed each average — a
 * month with 2 entries and a month with 30 shouldn't look equally
 * confident — and the month's min/max, for the band described above). The
 * legacy "Averager" pattern (functions/views/vis/charts/
 * happiness_averager.js) bins by day-type too; that's left out here since
 * it'd need a second grouping dimension this first pass doesn't have a UI
 * for yet. */
export async function getHappinessAveragerData(): Promise<MonthlyAverage[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, happiness: days.happiness })
    .from(days)
    .where(isNotNull(days.happiness))
    .orderBy(asc(days.date));

  // Monthly bucketing via the shared groupByPeriod/summarizePeriods helper
  // (#16) — this used to be its own hand-rolled `Map<string, {sum,count}>`
  // here, duplicating the same "bucket by month" logic
  // getGymWeightComboData had above. min/max are computed straight off
  // each bucket's own items rather than through summarizePeriods (which
  // only ever returns avg/count) — no need to generalize that shared
  // helper for a min/max case only this one call site uses so far.
  const buckets = groupByPeriod(rows, "month", (r) => r.date);
  const summaries = summarizePeriods(buckets, (r) => r.happiness as number);
  return buckets.map((bucket, i) => {
    const values = bucket.items.map((r) => r.happiness as number);
    return {
      month: bucket.key,
      avg: summaries[i].avg,
      count: summaries[i].count,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  });
}

// --- People network ---------------------------------------------------

export type NetworkNode = { id: number; name: string; count: number; color: string | null };
export type NetworkEdge = { source: number; target: number; weight: number };
export type PeopleNetworkData = { nodes: NetworkNode[]; edges: NetworkEdge[] };

/** A co-occurrence graph: nodes are people, sized by how many days they were
 * logged in any of the 10 person slots; edges connect two people who were
 * both logged on the same day, weighted by how often that's happened.
 * Computed in JS rather than SQL — the 10 slots are 10 separate FK columns
 * (see schema.ts), not rows in a table, so there's nothing to GROUP BY;
 * unpivoting them per day and tallying pairs is simplest done here, and
 * `days` is only ~3-4k rows, cheap to pull whole. Capped to the `maxNodes`
 * most-mentioned people — the legacy app didn't cap this at all, but a
 * force-directed layout with (in this diary's case) 700 catalog people
 * would be unreadable regardless of screen size. */
export async function getPeopleNetworkData(maxNodes = 40): Promise<PeopleNetworkData> {
  const db = getDb();
  const rows = await db
    .select({
      p1: days.positivePerson1Id,
      p2: days.positivePerson2Id,
      p3: days.positivePerson3Id,
      p4: days.positivePerson4Id,
      p5: days.positivePerson5Id,
      p6: days.positivePerson6Id,
      p7: days.positivePerson7Id,
      n1: days.negativePerson1Id,
      n2: days.negativePerson2Id,
      n3: days.negativePerson3Id,
    })
    .from(days);

  const appearanceCount = new Map<number, number>();
  const coOccurrence = new Map<string, number>(); // key `${lowerId}-${higherId}`

  for (const row of rows) {
    const ids = [row.p1, row.p2, row.p3, row.p4, row.p5, row.p6, row.p7, row.n1, row.n2, row.n3].filter(
      (id): id is number => id !== null,
    );
    const unique = [...new Set(ids)];
    for (const id of unique) {
      appearanceCount.set(id, (appearanceCount.get(id) ?? 0) + 1);
    }
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const [a, b] = unique[i] < unique[j] ? [unique[i], unique[j]] : [unique[j], unique[i]];
        const key = `${a}-${b}`;
        coOccurrence.set(key, (coOccurrence.get(key) ?? 0) + 1);
      }
    }
  }

  const topIds = [...appearanceCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxNodes)
    .map(([id]) => id);
  const topSet = new Set(topIds);

  if (topIds.length === 0) return { nodes: [], edges: [] };

  // Left-joined for the tag's color (#23 follow-up: the network graph
  // colors each person by their tag, same as everywhere else in the app a
  // person shows up tagged) — a person with no tag, or no color set on
  // their tag, falls back to the chart's own default color at the call
  // site rather than here, so this stays a plain "what's in the DB" read.
  const peopleRows = await db
    .select({ id: people.id, name: people.name, color: tags.color })
    .from(people)
    .leftJoin(tags, eq(people.tagId, tags.id))
    .where(inArray(people.id, topIds));
  const infoById = new Map<number, { name: string; color: string | null }>(
    peopleRows.map((p): [number, { name: string; color: string | null }] => [
      p.id,
      { name: p.name, color: p.color },
    ]),
  );

  const nodes: NetworkNode[] = topIds.map((id) => ({
    id,
    name: infoById.get(id)?.name ?? "?",
    count: appearanceCount.get(id) ?? 0,
    color: infoById.get(id)?.color ?? null,
  }));

  const edges: NetworkEdge[] = [];
  for (const [key, weight] of coOccurrence) {
    const [aStr, bStr] = key.split("-");
    const a = Number(aStr);
    const b = Number(bStr);
    if (topSet.has(a) && topSet.has(b)) edges.push({ source: a, target: b, weight });
  }

  return { nodes, edges };
}

// --- Country visits (world choropleth, #24) -------------------------------

export type CountryVisitEntry = { country: string; days: number };

/** Distinct days logged in each country, resolved the same way the place
 * leaderboard's root-color join does: a day's place1/place2 aren't
 * themselves countries (they're specific cities/venues), so each one's
 * root ancestor — the first segment of its idPath — is looked up and named
 * (see places.color's own schema.ts comment on why only root places carry
 * that identity). A day where both slots land in the same country counts
 * once, not twice — this is "was I in France that day," not a mention
 * tally like the leaderboard's weighted slot1/slot2 scheme, since summing
 * per-country here feeds a choropleth's per-day-presence read, not a
 * ranked "which place got logged most" one.
 *
 * Aggregated in JS rather than SQL, same reasoning as getPeopleNetworkData
 * just above: `days` is only a few thousand rows, and expressing "the
 * root ancestor of whichever of two nullable FKs is set, deduped per day"
 * as a single SQL query is far less legible than three small queries plus
 * a Set. Place names are joined against map geometry by
 * normalizeCountryName (src/lib/geo/country-names.ts) at the call site,
 * not here — this function stays a plain "what did the catalog say" read.
 */
export async function getCountryVisitData(): Promise<CountryVisitEntry[]> {
  const db = getDb();
  const dayRows = await db
    .select({ date: days.date, place1Id: days.place1Id, place2Id: days.place2Id })
    .from(days)
    .where(or(isNotNull(days.place1Id), isNotNull(days.place2Id)));

  const referencedIds = new Set<number>();
  for (const row of dayRows) {
    if (row.place1Id !== null) referencedIds.add(row.place1Id);
    if (row.place2Id !== null) referencedIds.add(row.place2Id);
  }
  if (referencedIds.size === 0) return [];

  const placeRows = await db
    .select({ id: places.id, idPath: places.idPath })
    .from(places)
    .where(inArray(places.id, [...referencedIds]));
  const rootIdByPlaceId = new Map<number, number | null>();
  for (const p of placeRows) {
    const rootIdStr = p.idPath?.split("/")[0];
    rootIdByPlaceId.set(p.id, rootIdStr ? Number(rootIdStr) : null);
  }

  const rootIds = [...new Set([...rootIdByPlaceId.values()].filter((id): id is number => id !== null))];
  const rootRows = rootIds.length
    ? await db.select({ id: places.id, name: places.name }).from(places).where(inArray(places.id, rootIds))
    : [];
  const nameByRootId = new Map(rootRows.map((r) => [r.id, r.name]));

  // Set of "date\0country" pairs — the null-byte separator can't appear in
  // either a date string or a place name, so it's a safe join delimiter
  // for using the pair as a Set key.
  const dayCountryPairs = new Set<string>();
  for (const row of dayRows) {
    for (const placeId of [row.place1Id, row.place2Id]) {
      if (placeId === null) continue;
      const rootId = rootIdByPlaceId.get(placeId);
      const country = rootId != null ? nameByRootId.get(rootId) : undefined;
      if (country) dayCountryPairs.add(`${row.date}\0${country}`);
    }
  }

  const counts = new Map<string, number>();
  for (const pair of dayCountryPairs) {
    const country = normalizeCountryName(pair.split("\0")[1]);
    counts.set(country, (counts.get(country) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([country, dayCount]) => ({ country, days: dayCount }))
    .sort((a, b) => b.days - a.days);
}

// --- US state visits (state choropleth, #287) -----------------------------

export type UsStateVisitEntry = { state: string; days: number };

/**
 * Distinct days logged in each US state — the state-level counterpart to
 * getCountryVisitData above, and deliberately the same "was I there that
 * day" read rather than a mention tally: a day whose two place slots both
 * land in Georgia counts once, not twice, because a choropleth's fill
 * encodes per-day presence.
 *
 * Where getCountryVisitData can stop at idPath's *first* segment (the
 * root place is the country, by construction), a state sits at no fixed
 * depth, so resolution goes through resolveUsStateName's full namePath
 * walk — see its own doc comment for why "the second segment is the
 * state" is a fact about today's data rather than an invariant, and why
 * scanning root-to-leaf is what keeps a city named after a state (New
 * York, Washington) from shadowing the real one.
 *
 * Territories us-atlas ships but d3's albersUsa composite can't place
 * (the US Virgin Islands, which this catalog really does have days in)
 * are resolved and returned here like any other entry. Dropping them is
 * the *chart's* call, not this function's — it renders them as an
 * explicit off-map note rather than letting real logged days disappear
 * because of a projection's limits.
 *
 * Aggregated in JS rather than SQL for the same reason every neighboring
 * function in this file is: `days` is a few thousand rows, and the walk
 * above has no reasonable SQL expression.
 */
export async function getUsStateVisitData(): Promise<UsStateVisitEntry[]> {
  const db = getDb();
  const dayRows = await db
    .select({ date: days.date, place1Id: days.place1Id, place2Id: days.place2Id })
    .from(days)
    .where(or(isNotNull(days.place1Id), isNotNull(days.place2Id)));

  const referencedIds = new Set<number>();
  for (const row of dayRows) {
    if (row.place1Id !== null) referencedIds.add(row.place1Id);
    if (row.place2Id !== null) referencedIds.add(row.place2Id);
  }
  if (referencedIds.size === 0) return [];

  const placeRows = await db
    .select({ id: places.id, namePath: places.namePath })
    .from(places)
    .where(inArray(places.id, [...referencedIds]));
  const stateByPlaceId = new Map<number, string>();
  for (const p of placeRows) {
    const state = resolveUsStateName(p.namePath);
    if (state) stateByPlaceId.set(p.id, state);
  }

  // Set of "date\0state" pairs — same null-byte join delimiter, and same
  // reasoning, as getCountryVisitData's own dedup above: neither a date
  // string nor a us-atlas feature name can contain a null byte, so the
  // pair is safe to use as a Set key.
  const dayStatePairs = new Set<string>();
  for (const row of dayRows) {
    for (const placeId of [row.place1Id, row.place2Id]) {
      if (placeId === null) continue;
      const state = stateByPlaceId.get(placeId);
      if (state) dayStatePairs.add(`${row.date}\0${state}`);
    }
  }

  const counts = new Map<string, number>();
  for (const pair of dayStatePairs) {
    const state = pair.split("\0")[1];
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([state, dayCount]) => ({ state, days: dayCount }))
    .sort((a, b) => b.days - a.days);
}

// --- US county visits (state -> county drill-down, #107) ------------------

export type UsCountyVisitEntry = {
  /** 5-digit county FIPS — the join key the drilled-in chart matches
   * against us-atlas's own county feature ids, rather than a name (county
   * names repeat constantly across states: 34 different Washingtons). */
  fips: string;
  name: string;
  days: number;
};

export type UsCountyVisitData = {
  counties: UsCountyVisitEntry[];
  /** Day-presence that's inside the US but landed in no county polygon —
   * bad geocodes, essentially (see resolveCountyForPoint's own comment on
   * the three real cases). Surfaced rather than dropped so the number
   * can't quietly diverge from the state map's totals without anyone
   * noticing. */
  unresolvedDays: number;
};

/**
 * Distinct days logged in each US county, for #107's state -> county
 * drill-down. Same "was I there that day" dedup as the country and state
 * choropleths above it.
 *
 * Resolution is a **spatial join, not a hierarchy walk** — the one place
 * in this file that departs from the idPath/namePath pattern, because the
 * catalog has no county tier to walk (see resolveCountyForPoint's doc
 * comment for the measured evidence and why this isn't a shortcut).
 *
 * Cost: point-in-polygon over every distinct geocoded US place referenced
 * by a day, ~200ms on the current catalog. Paid per request on a
 * force-dynamic page, so it's deliberately scoped to *referenced* places
 * (a few hundred) rather than every US place in the catalog, and the
 * decoded county geometry is cached for the life of the process.
 */
export async function getUsCountyVisitData(): Promise<UsCountyVisitData> {
  const db = getDb();
  const dayRows = await db
    .select({ date: days.date, place1Id: days.place1Id, place2Id: days.place2Id })
    .from(days)
    .where(or(isNotNull(days.place1Id), isNotNull(days.place2Id)));

  const referencedIds = new Set<number>();
  for (const row of dayRows) {
    if (row.place1Id !== null) referencedIds.add(row.place1Id);
    if (row.place2Id !== null) referencedIds.add(row.place2Id);
  }
  if (referencedIds.size === 0) return { counties: [], unresolvedDays: 0 };

  const placeRows = await db
    .select({ id: places.id, namePath: places.namePath, lat: places.lat, lng: places.lng })
    .from(places)
    .where(inArray(places.id, [...referencedIds]));

  // Resolved once per place, not once per (day, place) pair — the same
  // place shows up on hundreds of days, and point-in-polygon is by far
  // the most expensive thing in this function.
  const countyByPlaceId = new Map<number, UsCounty>();
  const inUsWithoutCounty = new Set<number>();
  for (const p of placeRows) {
    const state = resolveUsStateName(p.namePath);
    if (!state) continue; // not in the US at all — not this chart's data
    if (p.lat == null || p.lng == null) {
      inUsWithoutCounty.add(p.id);
      continue;
    }
    const county = resolveCountyForPoint(p.lat, p.lng, US_STATE_FIPS_BY_NAME.get(state) ?? null);
    if (county) countyByPlaceId.set(p.id, county);
    else inUsWithoutCounty.add(p.id);
  }

  const dayCountyPairs = new Set<string>();
  const unresolvedDayPlacePairs = new Set<string>();
  for (const row of dayRows) {
    for (const placeId of [row.place1Id, row.place2Id]) {
      if (placeId === null) continue;
      const county = countyByPlaceId.get(placeId);
      if (county) dayCountyPairs.add(`${row.date}\0${county.fips}`);
      else if (inUsWithoutCounty.has(placeId)) unresolvedDayPlacePairs.add(`${row.date}\0${placeId}`);
    }
  }

  const nameByFips = new Map<string, string>();
  for (const county of countyByPlaceId.values()) nameByFips.set(county.fips, county.name);

  const counts = new Map<string, number>();
  for (const pair of dayCountyPairs) {
    const fips = pair.split("\0")[1];
    counts.set(fips, (counts.get(fips) ?? 0) + 1);
  }

  return {
    counties: [...counts.entries()]
      .map(([fips, dayCount]) => ({ fips, name: nameByFips.get(fips) ?? fips, days: dayCount }))
      .sort((a, b) => b.days - a.days),
    unresolvedDays: unresolvedDayPlacePairs.size,
  };
}

// --- City heatmap (#266) ---------------------------------------------------

// The committed, derived artifact from #265's geo-build.mjs pipeline — read
// here purely for each feature's own `name`/`root` properties (a TopoJSON
// object's `.geometries` carry `properties` without needing any arc
// resolution), not for the geometry itself. The chart component
// (city-heatmap-chart.tsx) does its own separate client-side import of the
// same files to actually decode + render them — same split
// world-visits-chart.tsx already has between getCountryVisitData (no
// geometry import at all, since country names are globally unique) and its
// own client-side world-atlas import. Duplicating the import isn't
// duplicating logic: this file needs a name index; the chart needs paths.
const CITY_TOPOLOGIES: Record<CityKey, { objects: Record<string, { geometries: { properties: { name: string; root: string } }[] }> }> = {
  atlanta: atlantaTopo,
  "dc-metro": dcMetroTopo,
  dubai: dubaiTopo,
  nyc: nycTopo,
  istanbul: istanbulTopo,
};

function loadCityGeometryNames(cityKey: CityKey): Map<string, Set<string>> {
  const byRoot = new Map<string, Set<string>>();
  for (const geometry of CITY_TOPOLOGIES[cityKey].objects[cityKey].geometries) {
    const { name, root } = geometry.properties;
    if (!byRoot.has(root)) byRoot.set(root, new Set());
    byRoot.get(root)!.add(name);
  }
  return byRoot;
}

// `root` travels alongside `name` (not folded into one string) because
// two different roots can share a neighborhood name — a chart matching
// purely by name would silently merge, e.g., a real "Downtown" in
// Washington with an unrelated "Downtown" in Arlington. The consuming
// chart component keys its own lookup by (root, name) together, the same
// pair each decoded topojson feature's own `properties` already carries.
export type CityHeatmapNeighborhood = { root: string; name: string; days: number };
export type CityHeatmapDestination = {
  id: number;
  name: string;
  lat: number;
  lng: number;
  days: number;
  /** Which geometry feature this place itself resolves to, or null if
   * it's in the city but doesn't match any drawn neighborhood — surfaced
   * in the chart's marker tooltip (not just logged server-side) so a
   * geometry/alias-table gap can be spotted and fixed from the map
   * itself, per #177's own follow-up ask. */
  neighborhood: { root: string; name: string } | null;
};
export type CityHeatmapData = {
  neighborhoods: CityHeatmapNeighborhood[];
  destinations: CityHeatmapDestination[];
};

/**
 * Per-city choropleth + destination-marker data for #177's city-heatmap
 * chart. `neighborhoods` is a day-presence tally per geometry feature name
 * (same "was I there that day" dedup getCountryVisitData uses, generalized
 * from "first namePath segment" to resolveCityFeatureName's arbitrary-depth
 * walk — see that function's own comment on why DC-metro/NYC need more than
 * one segment checked). `destinations` is every geocoded specific place
 * anywhere in the city (isPlaceInCity, not resolveCityFeatureName — every
 * visited place under the city's roots, not just ones that also resolve to
 * a drawn neighborhood) with the same day-presence count, for the marker
 * overlay.
 *
 * `destinations` intentionally includes places whose own neighborhood
 * *doesn't* resolve to any geometry feature (a real gap: an unmapped or
 * misnamed neighborhood, see e.g. atlanta-names.ts's documented Briarcliff
 * Woods case). Those still get a real dot at their real geocoded position,
 * with no fill underneath it — which is exactly what makes a geometry/
 * alias-table gap visible on the rendered map instead of the place just
 * silently disappearing from the chart.
 *
 * Two day-presence tallies over the same underlying rows, not one tally
 * fed two ways — a day spent at 3 different addresses inside one
 * neighborhood is 1 day of "presence" for that neighborhood's fill, but up
 * to 3 separate (day, place) pairs for the destinations ranking below (a
 * neighborhood value isn't just its top destination's value summed).
 */
export async function getCityHeatmapData(cityKey: CityKey): Promise<CityHeatmapData> {
  const city = CITIES[cityKey];
  const db = getDb();

  const dayRows = await db
    .select({ date: days.date, place1Id: days.place1Id, place2Id: days.place2Id })
    .from(days)
    .where(or(isNotNull(days.place1Id), isNotNull(days.place2Id)));

  const referencedIds = new Set<number>();
  for (const row of dayRows) {
    if (row.place1Id !== null) referencedIds.add(row.place1Id);
    if (row.place2Id !== null) referencedIds.add(row.place2Id);
  }
  if (referencedIds.size === 0) return { neighborhoods: [], destinations: [] };

  const placeRows = await db
    .select({
      id: places.id,
      name: places.name,
      idPath: places.idPath,
      namePath: places.namePath,
      lat: places.lat,
      lng: places.lng,
    })
    .from(places)
    .where(inArray(places.id, [...referencedIds]));
  const placeById = new Map(placeRows.map((p) => [p.id, p]));

  function splitResolvedKey(key: string): { root: string; name: string } {
    const [root, name] = key.split("\0");
    return { root, name };
  }

  const geometryNamesByRoot = loadCityGeometryNames(cityKey);
  // Keyed by "root\0featureName", not featureName alone — two different
  // roots (e.g. Washington and Arlington) could share a neighborhood
  // name; see CityHeatmapNeighborhood's own comment.
  const resolvedByPlaceId = new Map<number, string>();
  for (const p of placeRows) {
    if (!p.idPath || !p.namePath) continue;
    const resolved = resolveCityFeatureName({ idPath: p.idPath, namePath: p.namePath }, city.sources, geometryNamesByRoot, city.normalize);
    if (resolved) resolvedByPlaceId.set(p.id, `${resolved.root}\0${resolved.featureName}`);
  }

  // Two different membership tests, deliberately: the choropleth fill
  // only makes sense for a place that resolves to an actual drawn
  // feature (resolvedByPlaceId, the narrower test), but the destination
  // dots use the broader isPlaceInCity — a place can genuinely be inside
  // the city with no matching neighborhood polygon (a real geometry/
  // alias gap, not a bug), and plotting it anyway is what lets that gap
  // be spotted on the map instead of the place just silently vanishing.
  const dayNeighborhoodPairs = new Set<string>();
  const dayPlacePairs = new Set<string>();
  for (const row of dayRows) {
    for (const placeId of [row.place1Id, row.place2Id]) {
      if (placeId === null) continue;
      const place = placeById.get(placeId);
      if (!place?.idPath || !isPlaceInCity(place.idPath, city.sources)) continue;
      dayPlacePairs.add(`${row.date}\0${placeId}`);
      const resolvedKey = resolvedByPlaceId.get(placeId);
      if (resolvedKey) dayNeighborhoodPairs.add(`${row.date}\0${resolvedKey}`);
    }
  }

  const neighborhoodCounts = new Map<string, number>();
  for (const pair of dayNeighborhoodPairs) {
    const resolvedKey = pair.split("\0").slice(1).join("\0");
    neighborhoodCounts.set(resolvedKey, (neighborhoodCounts.get(resolvedKey) ?? 0) + 1);
  }
  const neighborhoods = [...neighborhoodCounts.entries()].map(([resolvedKey, dayCount]) => ({
    ...splitResolvedKey(resolvedKey),
    days: dayCount,
  }));

  const placeCounts = new Map<number, number>();
  for (const pair of dayPlacePairs) {
    const id = Number(pair.split("\0")[1]);
    placeCounts.set(id, (placeCounts.get(id) ?? 0) + 1);
  }
  const destinations = [...placeCounts.entries()]
    .map(([id, dayCount]): CityHeatmapDestination | null => {
      const place = placeById.get(id);
      if (!place || place.lat == null || place.lng == null) return null; // ungeocoded — nothing to plot
      const resolvedKey = resolvedByPlaceId.get(id);
      return {
        id,
        name: place.name,
        lat: place.lat,
        lng: place.lng,
        days: dayCount,
        neighborhood: resolvedKey ? splitResolvedKey(resolvedKey) : null,
      };
    })
    .filter((d): d is CityHeatmapDestination => d !== null)
    .sort((a, b) => b.days - a.days);

  return { neighborhoods, destinations };
}

// --- Place hierarchy (sunburst, #118) -------------------------------------

export type PlaceHierarchyRow = {
  id: number;
  name: string;
  /** The catalog's own shorthand for this place, when it has one — the
   * sunburst substitutes it for a name too long to fit on an arc (the
   * tooltip still spells the full name out). Legacy's `location_burst`
   * did the same swap, just keyed off name length rather than fit. */
  alias: string | null;
  parentId: number | null;
  category: string | null;
  subcategory: string | null;
  /** Color of this place's *root* ancestor — see getPlaceLeaderboardData's
   * own comment on why a leaf's "country color" is its root's, not its
   * own. Null when unset or when idPath hasn't been backfilled. */
  rootColor: string | null;
  /** Weighted mentions of this place *itself*, not including places
   * beneath it in the tree — the sunburst sums a subtree's own values as
   * it lays out, so pre-rolling them up here would double-count every
   * ancestor. */
  value: number;
};

/** Every place that was logged at least once, plus enough of the catalog
 * around it to reassemble the tree, with the same 2x-slot-1 / 1x-slot-2
 * weighting the place leaderboard uses (legacy's own scheme — see
 * getPlaceLeaderboardData). Deliberately returns flat rows, not a tree:
 * the chart page offers two different hierarchies over the same rows
 * (geography via parentId, taxonomy via category/subcategory), and
 * switching between them shouldn't cost a round trip. Tree assembly is
 * `@/lib/viz/hierarchy`'s job.
 *
 * Unlogged places are kept rather than filtered in SQL, because an
 * ancestor with no mentions of its own ("USA", when only its cities were
 * ever logged) is still a required link in the chain; the client prunes
 * subtrees that sum to zero once the tree exists (pruneEmptyBranches).
 */
export async function getPlaceHierarchyData(): Promise<PlaceHierarchyRow[]> {
  const db = getDb();
  const hierarchyRootPlaces = alias(places, "hierarchy_root_places");

  const rows = await db
    .select({
      id: places.id,
      name: places.name,
      alias: places.alias,
      parentId: places.parentId,
      category: places.category,
      subcategory: places.subcategory,
      rootColor: hierarchyRootPlaces.color,
      value: sql<number>`
        coalesce(sum(case when ${days.place1Id} = ${places.id} then 2 else 0 end), 0)
        + coalesce(sum(case when ${days.place2Id} = ${places.id} then 1 else 0 end), 0)
      `.as("value"),
    })
    .from(places)
    // Left, not inner (unlike the leaderboard's join): a place with no
    // mentions still has to come back, or the tree loses its middle links.
    .leftJoin(days, sql`${days.place1Id} = ${places.id} or ${days.place2Id} = ${places.id}`)
    .leftJoin(
      hierarchyRootPlaces,
      sql`${hierarchyRootPlaces.id} = nullif(split_part(${places.idPath}, '/', 1), '')::int`,
    )
    .groupBy(places.id, hierarchyRootPlaces.color);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    alias: r.alias,
    parentId: r.parentId,
    category: r.category,
    subcategory: r.subcategory,
    rootColor: r.rootColor,
    value: Number(r.value),
  }));
}

// --- Health & activity (#218) --------------------------------------------
//
// Five charts from the legacy inventory (#209), all on primitives that
// already shipped. Every fetcher here returns a **daily** series, never a
// pre-bucketed one: the charts carry a period picker, so the bucketing has
// to happen client-side where the selection lives. That's exactly the split
// `src/lib/viz/bin.ts` documents — re-bucketing an already-fetched series
// is its job, and pushing the aggregation into SQL here would freeze the
// bucket size at query time and make the picker impossible.

/** A single value per calendar day — the shape InteractiveCalendar and
 * InteractiveScroller consume directly, and the input the trend charts
 * re-bucket. Deliberately generic: most of the remaining chart backlog is
 * "this one `days` column, by day". */
export type DailyValue = { date: string; value: number };

/** Every logged value of one nullable numeric `days` column, oldest first. */
async function dailyValuesOf(column: AnyPgColumn): Promise<DailyValue[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, value: column })
    .from(days)
    .where(isNotNull(column))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ date: r.date, value: Number(r.value) }));
}

export function getCoffeeDailyData(): Promise<DailyValue[]> {
  return dailyValuesOf(days.coffees);
}

export function getDistanceDailyData(): Promise<DailyValue[]> {
  return dailyValuesOf(days.distanceWalkedKm);
}

/** A day's training: minutes trained and how many exercises made them up. */
export type TrainingDay = { date: string; minutes: number; exercises: number };

/**
 * Training per day, measured as **time trained**.
 *
 * Time is the honest measure of volume. Counting `workouts` rows counts one
 * per exercise performed, so a session of eight movements outweighs a
 * two-hour hike logged as one; counting days treats a ten-minute session
 * and a three-hour one alike. Summed duration is the only one of the three
 * that answers "how much did I actually train".
 *
 * `durationMinutes` is nullable, so this is worth stating: in practice
 * 1,371 of 1,376 rows carry one, and the five that don't contribute zero.
 * At that coverage a sum is safe. If duration ever became sparse — a new
 * category logged without it — this would quietly understate, and the fix
 * would be to fall back rather than keep summing.
 *
 * **Days with no training are returned as explicit zeros**, across the span
 * from the first logged workout to the last. Leaving them out makes any
 * bucketing of this series jump the gap, drawing a slope across months
 * where nothing happened — the real data has exactly one such month
 * (2023-01) between two active ones. Zero is the honest value because
 * exercise was being actively logged either side of it: nothing recorded
 * means nothing done, not nothing known. That reasoning is specific to a
 * count-like measure over a period that was otherwise being tracked, and
 * deliberately does not transfer to the `days`-column series above, where
 * an absent day means nothing was recorded and a zero would be a
 * fabricated measurement.
 *
 * Padding at day granularity rather than by month means the zero-filling
 * survives whatever bucket size the reader picks.
 */
export async function getTrainingDailyData(): Promise<TrainingDay[]> {
  const db = getDb();
  const rows = await db
    .select({ date: workouts.date, durationMinutes: workouts.durationMinutes })
    .from(workouts)
    .orderBy(asc(workouts.date));
  if (rows.length === 0) return [];

  const byDate = new Map<string, { minutes: number; exercises: number }>();
  for (const row of rows) {
    const existing = byDate.get(row.date) ?? { minutes: 0, exercises: 0 };
    existing.minutes += row.durationMinutes ?? 0;
    existing.exercises += 1;
    byDate.set(row.date, existing);
  }

  const out: TrainingDay[] = [];
  const last = rows[rows.length - 1].date;
  for (let date = rows[0].date; date <= last; date = addDays(date, 1)) {
    const found = byDate.get(date);
    out.push({ date, minutes: found?.minutes ?? 0, exercises: found?.exercises ?? 0 });
  }
  return out;
}

// --- People over time (#220) ----------------------------------------------

/** One day's people, with the tag each belongs to and the day's own
 * happiness — the latter because the impact score (`src/lib/impact.ts`) is
 * a function of both the person's slot and how the day went. */
export type PeopleDay = { date: string; happiness: number | null; people: PersonOnDay[] };

/** `tagName`/`tagColor` are null for anyone untagged — most people have a
 * tag, but nothing requires one, so a consumer grouping by tag has to
 * handle the ungrouped case rather than assuming. */
export type PersonOnDay = {
  name: string;
  tagName: string | null;
  tagColor: string | null;
  /** 1-7, the positive slot they occupied. Slot order carries a soft
   * ranking that the impact score reads — see `src/lib/impact.ts`. */
  slot: number;
};

/**
 * Who was logged on each day, oldest first.
 *
 * **Positive slots only.** `getPeopleNetworkData` unions the negative slots
 * too, because a co-occurrence graph asks who appears in your days at all.
 * Here it would add nothing: the negative slots hold **5 appearances in the
 * entire history**, against 17,954 positive ones. Three people, five days.
 * Carrying them through the fold, the palette and the legend to draw
 * something invisible isn't a trade worth making — and unlike the recap's
 * exclusion (#199), which was a judgment about tone, this one is just
 * arithmetic.
 *
 * Names rather than ids because that's what a chart legend needs, and
 * because `people.name` is unique — so it identifies a person as well as
 * the id does, without a second lookup at every call site. Each person
 * carries their tag's name and color too, so a consumer can colour by
 * group without re-joining.
 */
export async function getPeopleDailyData(): Promise<PeopleDay[]> {
  const db = getDb();
  const slots = [
    days.positivePerson1Id,
    days.positivePerson2Id,
    days.positivePerson3Id,
    days.positivePerson4Id,
    days.positivePerson5Id,
    days.positivePerson6Id,
    days.positivePerson7Id,
  ];

  const [dayRows, personRows] = await Promise.all([
    db
      .select({
        date: days.date,
        happiness: days.happiness,
        p1: slots[0],
        p2: slots[1],
        p3: slots[2],
        p4: slots[3],
        p5: slots[4],
        p6: slots[5],
        p7: slots[6],
      })
      .from(days)
      .orderBy(asc(days.date)),
    db
      .select({ id: people.id, name: people.name, tagName: tags.name, tagColor: tags.color })
      .from(people)
      .leftJoin(tags, eq(tags.id, people.tagId)),
  ]);

  const byId = new Map(personRows.map((p) => [p.id, p]));
  const out: PeopleDay[] = [];
  for (const row of dayRows) {
    // Deduplicated by person, keeping their *earliest* slot: nothing stops
    // one person filling two slots on a day, "who was I with" counts them
    // once, and the earliest slot is the one the impact score should read
    // since earlier slots weigh more.
    const present: PersonOnDay[] = [];
    const seen = new Set<number>();
    [row.p1, row.p2, row.p3, row.p4, row.p5, row.p6, row.p7].forEach((id, index) => {
      if (id === null || seen.has(id)) return;
      seen.add(id);
      const person = byId.get(id);
      if (person) {
        present.push({
          name: person.name,
          tagName: person.tagName,
          tagColor: person.tagColor,
          slot: index + 1,
        });
      }
    });
    if (present.length > 0) out.push({ date: row.date, happiness: row.happiness, people: present });
  }
  return out;
}

// --- Mood calendars (#216) ------------------------------------------------

/** Every logged happiness score, oldest first. */
export function getHappinessCalendarData(): Promise<DailyValue[]> {
  return dailyValuesOf(days.happiness);
}

/** A day and how it was classified (`days.dayType`), oldest first. Days with
 * no type are omitted rather than given one. */
export type DayTypeDay = { date: string; dayType: string };

export async function getDayTypeCalendarData(): Promise<DayTypeDay[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, dayType: days.dayType })
    .from(days)
    .where(isNotNull(days.dayType))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ date: r.date, dayType: r.dayType as string }));
}

// --- Technology (#219) ----------------------------------------------------

/** A day's screen time, split by device. Either side may be null on a day
 * where only one was recorded. */
export type DeviceDay = {
  date: string;
  phoneMinutes: number | null;
  laptopMinutes: number | null;
};

/** Days with at least one device recorded, oldest first. */
export async function getDeviceUsageData(): Promise<DeviceDay[]> {
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
      phoneMinutes: days.phoneUsageMinutes,
      laptopMinutes: days.laptopUsageMinutes,
    })
    .from(days)
    .where(or(isNotNull(days.phoneUsageMinutes), isNotNull(days.laptopUsageMinutes)))
    .orderBy(asc(days.date));
  return rows;
}

/**
 * Instagram follower count per day.
 *
 * Cumulative rather than a daily rate — it's a running total, so it only
 * moves when it moves and never resets. Charts of it should say so: a
 * rolling average over a monotone series smooths nothing worth smoothing.
 */
export function getInstagramFollowersData(): Promise<DailyValue[]> {
  return dailyValuesOf(days.instagramFollowers);
}

// --- Where you were, over time (#221) --------------------------------------

/** One day and the countries it touched. Deduplicated: a day whose two
 * place slots are both in France counts France once, matching
 * `getCountryVisitData`'s "was I there that day" reading rather than the
 * leaderboard's weighted slot tally. */
export type CountryDay = { date: string; countries: string[] };

/**
 * Countries per day, oldest first.
 *
 * Resolves a place to its country the same way `getCountryVisitData` does —
 * a day's place slots hold specific venues, so the country is the root of
 * each one's `idPath`, never an assumed depth. Names are normalized here so
 * the categories a chart folds and colours match the map's own.
 *
 * Country rather than a finer level on purpose: it's the one level of this
 * tree with few enough members to sit inside a categorical palette. Metro
 * or venue would need the "which ancestor is the neighbourhood" question
 * settled first — see #214.
 */
export async function getCountryHistoryData(): Promise<CountryDay[]> {
  const db = getDb();
  const dayRows = await db
    .select({ date: days.date, place1Id: days.place1Id, place2Id: days.place2Id })
    .from(days)
    .where(or(isNotNull(days.place1Id), isNotNull(days.place2Id)))
    .orderBy(asc(days.date));

  const referencedIds = new Set<number>();
  for (const row of dayRows) {
    if (row.place1Id !== null) referencedIds.add(row.place1Id);
    if (row.place2Id !== null) referencedIds.add(row.place2Id);
  }
  if (referencedIds.size === 0) return [];

  const placeRows = await db
    .select({ id: places.id, idPath: places.idPath })
    .from(places)
    .where(inArray(places.id, [...referencedIds]));
  const rootIdByPlaceId = new Map<number, number | null>();
  for (const p of placeRows) {
    const rootIdStr = p.idPath?.split("/")[0];
    rootIdByPlaceId.set(p.id, rootIdStr ? Number(rootIdStr) : null);
  }

  const rootIds = [...new Set([...rootIdByPlaceId.values()].filter((id): id is number => id !== null))];
  const rootRows = rootIds.length
    ? await db.select({ id: places.id, name: places.name }).from(places).where(inArray(places.id, rootIds))
    : [];
  const nameByRootId = new Map(rootRows.map((r) => [r.id, r.name]));

  const out: CountryDay[] = [];
  for (const row of dayRows) {
    const countries = new Set<string>();
    for (const placeId of [row.place1Id, row.place2Id]) {
      if (placeId === null) continue;
      const rootId = rootIdByPlaceId.get(placeId);
      const name = rootId != null ? nameByRootId.get(rootId) : undefined;
      if (name) countries.add(normalizeCountryName(name));
    }
    if (countries.size > 0) out.push({ date: row.date, countries: [...countries] });
  }
  return out;
}
