import { asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { days, exercises, people, places, tags, workouts } from "@/db/schema";
import { groupByPeriod, summarizePeriods } from "@/lib/viz/bin";
import { normalizeCountryName } from "@/lib/geo/country-names";
import { parseDate } from "@/lib/date";
import { getProfileSettings, listProfileOccupations, listProfileRelationships, listProfileResidences } from "@/lib/profile";
import type { InteractiveScrollerRegion } from "@/components/charts/interactive/interactive-scroller";

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

export type WeightChartRegionGroups = {
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
export async function getWeightChartRegions(until: Date = new Date()): Promise<WeightChartRegionGroups> {
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

// --- Sleep calendar ---------------------------------------------------

export type SleepDay = { date: string; durationMinutes: number };

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
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
      sleepTime: days.sleepTime,
      wakeTime: days.wakeTime,
      wakeCrossedMidnight: days.wakeCrossedMidnight,
    })
    .from(days)
    .where(sql`${days.sleepTime} is not null and ${days.wakeTime} is not null`)
    .orderBy(asc(days.date));

  const out: SleepDay[] = [];
  for (const r of rows) {
    const sleepMin = hhmmToMinutes(r.sleepTime as string);
    const wakeMin = hhmmToMinutes(r.wakeTime as string);
    if (sleepMin === null || wakeMin === null) continue;
    const durationMinutes = wakeMin - sleepMin + (r.wakeCrossedMidnight ? 24 * 60 : 0);
    if (durationMinutes <= 0 || durationMinutes > 20 * 60) continue; // guard against bad data
    out.push({ date: r.date, durationMinutes });
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
