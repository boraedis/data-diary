import { asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { days, exercises, metros, people, places, tags, workoutSets, workouts, type DayType } from "@/db/schema";
import { groupByPeriod } from "@/lib/viz/bin";
import { normalizeCountryName } from "@/lib/geo/country-names";
import { resolveUsStateName, US_STATE_FIPS_BY_NAME } from "@/lib/geo/us-state-names";
import { resolveCountyForPoint, type UsCounty } from "@/lib/geo/us-counties";
import { hasAdminRegions, loadAdminRegionFeatures } from "@/lib/geo/admin-geometry";
import { resolveAdminRegion } from "@/lib/geo/admin-lookup";
import { resolveCountryCode } from "@/lib/geo/country-lookup";
import { CITIES, type CityKey } from "@/lib/geo/city-config";
import { resolveCityFeatureName, isPlaceInCity } from "@/lib/geo/resolve-city-place";
import atlantaTopo from "@/data/geo/atlanta.topo.json";
import dcMetroTopo from "@/data/geo/dc-metro.topo.json";
import dubaiTopo from "@/data/geo/dubai.topo.json";
import nycTopo from "@/data/geo/nyc.topo.json";
import istanbulTopo from "@/data/geo/istanbul.topo.json";
import { addDays, parseDate } from "@/lib/date";
import { buildPlaceLeaderboard, type PlaceLeaderboardEntry } from "@/lib/place-leaderboard";
import { getProfileSettings, listProfileOccupations, listProfileRelationships, listProfileResidences } from "@/lib/profile";
import type { InteractiveScrollerRegion } from "@/components/charts/interactive/interactive-scroller";
import type { LifeTimelineEntry } from "@/lib/life-timeline";
import type { PeopleNetworkDay, PeopleNetworkInput } from "@/lib/people-network";
export type { LifeTimelineEntry } from "@/lib/life-timeline";

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

/** The date of the earliest logged workout, or `null` if none — "when did
 * exercise tracking begin," used to default the "Weight and Training
 * Volume" combo chart's visible range to days that actually have exercise
 * context (#411) rather than a full history that predates tracking it at
 * all. Deliberately NOT applied to the standalone Weight/Exercise Trend
 * charts — Weight's own full history (much of it pre-dating exercise
 * tracking) is exactly what that chart is for, and Exercise Trend's data
 * already starts at this same date by construction (see
 * `getTrainingDailyData`'s own doc comment). */
export async function getFirstExerciseDate(): Promise<string | null> {
  const db = getDb();
  const [row] = await db.select({ date: workouts.date }).from(workouts).orderBy(asc(workouts.date)).limit(1);
  return row?.date ?? null;
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

/**
 * Where one place sits in the place hierarchy, plus its metro.
 *
 * Resolved by walking the place's ancestors and reading each one's own
 * category/subcategory, **not** by position in `namePath` — depth isn't
 * consistent. A Dubai address is `UAE/Dubai/Dubai/Internet City/...` while
 * an Atlanta one is `USA/Georgia/Atlanta/Midtown Atlanta/...`; indexing by
 * depth happens to line up for those two and stops lining up the moment a
 * tier is missing. The taxonomy is the thing that actually means something.
 */
type PlaceLevels = {
  country: string | null;
  state: string | null;
  municipality: string | null;
  neighborhood: string | null;
  metro: string | null;
};

const EMPTY_LEVELS: PlaceLevels = {
  country: null,
  state: null,
  municipality: null,
  neighborhood: null,
  metro: null,
};

/** Resolves `PlaceLevels` for every place id given, by fetching those
 * places' ancestors in two queries rather than one per entry. */
async function resolvePlaceLevels(placeIds: number[]): Promise<Map<number, PlaceLevels>> {
  const resolved = new Map<number, PlaceLevels>();
  if (placeIds.length === 0) return resolved;

  const db = getDb();
  const targets = await db
    .select({ id: places.id, idPath: places.idPath })
    .from(places)
    .where(inArray(places.id, placeIds));

  // Every ancestor of every target, from the materialized idPath
  // ("3/17/42/108/") — one round trip for the whole hierarchy instead of a
  // recursive walk per place.
  const ancestorIds = new Set<number>();
  const pathById = new Map<number, number[]>();
  for (const target of targets) {
    const ids = (target.idPath ?? "")
      .split("/")
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    pathById.set(target.id, ids);
    for (const id of ids) ancestorIds.add(id);
  }
  if (ancestorIds.size === 0) return resolved;

  const ancestors = await db
    .select({
      id: places.id,
      name: places.name,
      subcategory: places.subcategory,
      metroName: metros.name,
    })
    .from(places)
    .leftJoin(metros, eq(places.metroId, metros.id))
    .where(inArray(places.id, [...ancestorIds]));
  const ancestorById = new Map(ancestors.map((a) => [a.id, a]));

  for (const [placeId, ids] of pathById) {
    const levels: PlaceLevels = { ...EMPTY_LEVELS };
    for (const id of ids) {
      const ancestor = ancestorById.get(id);
      if (!ancestor) continue;
      switch (ancestor.subcategory) {
        case "Country":
          levels.country = ancestor.name;
          break;
        case "State/Province":
          levels.state = ancestor.name;
          break;
        case "Municipality":
          levels.municipality = ancestor.name;
          // `metroId` is only ever set on a Municipality (see
          // assertValidMetro in src/lib/days.ts), which is exactly what
          // makes metro a useful grouping: it merges Arlington, Reston and
          // Tysons Corner into one "Washington DC" lane.
          levels.metro = ancestor.metroName;
          break;
        case "Neighborhood":
        case "District":
          // "District" is the same tier by another name in some countries.
          // First one wins, so a neighborhood nested inside a district
          // doesn't overwrite the district with something more granular.
          levels.neighborhood ??= ancestor.name;
          break;
      }
    }
    resolved.set(placeId, levels);
  }

  return resolved;
}

/** The three profile timelines as `InteractiveTimeline` intervals, with
 * every dimension the chart can group by resolved up front — the
 * life-timeline chart (#310).
 *
 * A sibling of `getProfileRegionGroups` above rather than a reuse of it,
 * for two reasons worth stating since the two sit next to each other
 * reading almost identically:
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
 * Ids are prefixed per kind because the three tables have independent
 * `serial` primary keys — occupation 1 and residence 1 both exist, and the
 * timeline keys its marks by id across the whole chart.
 *
 * `alias ?? name` for the label, matching `getProfileRegionGroups` — alias
 * is the short form meant for exactly this kind of space-constrained
 * display.
 *
 * The grouping dimensions are resolved here, server-side, rather than
 * shipping the place tree to the client for it to walk: the client only
 * ever needs the resolved names, and they're a handful of short strings
 * per entry against a catalog of hundreds of places.
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

  const placeIds = [
    ...occupations.map((o) => o.placeId),
    ...residences.map((r) => r.placeId),
  ].filter((id): id is number => typeof id === "number");
  const levelsByPlaceId = await resolvePlaceLevels([...new Set(placeIds)]);

  const levelsFor = (placeId: number | null): PlaceLevels =>
    (placeId === null ? undefined : levelsByPlaceId.get(placeId)) ?? EMPTY_LEVELS;

  const occupationEntries: LifeTimelineEntry[] = occupations.map((item) => ({
    id: `occupation-${item.id}`,
    lane: "Occupation",
    label: item.alias ?? item.name,
    start: item.start,
    end: item.end,
    color: item.color,
    kind: "occupation",
    company: item.company,
    ...levelsFor(item.placeId),
    roles: item.roles.map((role) => ({
      id: `role-${role.id}`,
      label: role.position,
      start: role.start,
      end: role.end,
    })),
  }));

  const residenceEntries: LifeTimelineEntry[] = residences.map((item) => ({
    id: `residence-${item.id}`,
    lane: "Residence",
    label: item.alias ?? item.name,
    start: item.start,
    end: item.end,
    color: item.color,
    kind: "residence",
    company: null,
    ...levelsFor(item.placeId),
    roles: [],
  }));

  // Relationships have no place and no company, so they carry no grouping
  // dimensions at all — they only ever appear in the overview mode.
  const relationshipEntries: LifeTimelineEntry[] = relationships.map((item) => ({
    id: `relationship-${item.id}`,
    lane: "Relationship",
    label: item.alias ?? item.name,
    start: item.start,
    end: item.end,
    color: item.color,
    kind: "relationship",
    company: null,
    ...EMPTY_LEVELS,
    roles: [],
  }));

  // Emitted in this order deliberately: `layoutTimeline` orders lanes by
  // first appearance, so this array's order *is* the y-axis order. Work
  // first, then where you lived, then who with — roughly outermost to most
  // personal, and the same order the profile page lists them in.
  return [...occupationEntries, ...residenceEntries, ...relationshipEntries];
}

// --- Sleep calendar ---------------------------------------------------

export type SleepDay = { date: string; durationMinutes: number };

/**
 * A night plus where it was spent and any naps that day — the private-only
 * superset of `SleepDay`.
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
  /** `days.napMinutes`, or null when no nap was recorded that day. Matched
   * by calendar date to the night's own row, same as location — a nap
   * doesn't get its own independent timeline here, just an optional
   * addend to that night's sleep value. */
  napMinutes: number | null;
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
      napMinutes: days.napMinutes,
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
    out.push({ date: r.date, durationMinutes, locationType: r.locationType, napMinutes: r.napMinutes });
  }
  return out;
}

// --- Weight + workout volume combo ---------------------------------------------------

export type WorkoutMonth = { month: string; hours: number }; // month = "YYYY-MM"

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

/** Weight (line) alongside weightlifting volume (bars, one per calendar
 * month — daily hours would be too sparse/spiky to read as bars over a
 * multi-year range, monthly is the legacy chart's effective resolution
 * too). Two independently-shaped series sharing one time x-axis and two
 * y-axes, ported from the legacy app's bespoke `LineBarChart` in
 * gym-weight_chart.js.
 *
 * The bars are hours spent on strength-category workouts, not a count of
 * all logged workouts (#325 — the original version counted every workout
 * row regardless of category, which read as a workout frequency chart
 * despite being labeled "training volume"). Per workout, hours come from
 * `workouts.durationMinutes` when it's set — despite the schema's own
 * comment on `workouts` claiming strength never uses that column, the
 * Hevy importer (hevy-import.ts) actually does populate it for strength
 * workouts too, apportioning the pasted session's total time across each
 * exercise (and, for an exercise with explicitly timed sets like a plank,
 * setting it straight from that set's own `durationSeconds`) — that's the
 * real duration signal for most logged strength workouts. Only a workout
 * with no `durationMinutes` at all (manually entered, no Hevy import)
 * falls back to summing its own sets' `durationSeconds`, so a purely
 * rep/weight-only manual entry with neither contributes zero rather than
 * a guessed estimate.
 *
 * Returns the *full* weight and training history — #411 originally
 * restricted this in SQL to dates on/after the first tracked exercise, but
 * that threw away real, viewable weight history a reader might still want
 * to scroll back into. The chart itself instead defaults its own
 * `TimeRangePicker` to that same "since exercise tracking began" window
 * (see `GymWeightComboChart`), which narrows the *initial view* without
 * narrowing what's actually reachable. */
export async function getGymWeightComboData(): Promise<GymWeightComboData> {
  const db = getDb();
  const [weightRows, strengthWorkouts, strengthSetDurations] = await Promise.all([
    db
      .select({ date: days.date, weightKg: days.weightKg })
      .from(days)
      .where(isNotNull(days.weightKg))
      .orderBy(asc(days.date)),
    db
      .select({ id: workouts.id, date: workouts.date, durationMinutes: workouts.durationMinutes })
      .from(workouts)
      .innerJoin(exercises, eq(workouts.exerciseId, exercises.id))
      .where(eq(exercises.category, "strength"))
      .orderBy(asc(workouts.date)),
    db
      .select({ workoutId: workoutSets.workoutId, durationSeconds: workoutSets.durationSeconds })
      .from(workoutSets)
      .innerJoin(workouts, eq(workoutSets.workoutId, workouts.id))
      .innerJoin(exercises, eq(workouts.exerciseId, exercises.id))
      .where(eq(exercises.category, "strength")),
  ]);

  const setSecondsByWorkoutId = new Map<number, number>();
  for (const s of strengthSetDurations) {
    if (s.durationSeconds === null) continue;
    setSecondsByWorkoutId.set(s.workoutId, (setSecondsByWorkoutId.get(s.workoutId) ?? 0) + s.durationSeconds);
  }
  const strengthWorkoutHours = strengthWorkouts.map((w) => ({
    date: w.date,
    hours: w.durationMinutes !== null ? w.durationMinutes / 60 : (setSecondsByWorkoutId.get(w.id) ?? 0) / 3600,
  }));

  // Monthly bucketing via the shared groupByPeriod helper (#16) — this
  // used to be its own hand-rolled `Map<string, number>` here, duplicating
  // the same "bucket by month" logic getHappinessAveragerData had below.
  const workoutsByMonth = groupByPeriod(strengthWorkoutHours, "month", (r) => r.date).map(({ key, items }) => ({
    month: key,
    hours: items.reduce((sum, r) => sum + r.hours, 0),
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
  /** Hours spent on this workout — same fallback `getGymWeightComboData`
   * already uses (#334, generalized here to every category rather than
   * strength-only): workout-level `durationMinutes` when set, else summed
   * `workoutSets.durationSeconds`, else 0 for a purely rep/weight-only
   * manual entry with neither. */
  hours: number;
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
  const [rows, setDurations] = await Promise.all([
    db
      .select({
        id: workouts.id,
        date: workouts.date,
        category: exercises.category,
        exerciseId: exercises.id,
        exerciseName: exercises.name,
        subtype: workouts.subtype,
        durationMinutes: workouts.durationMinutes,
      })
      .from(workouts)
      .innerJoin(exercises, eq(workouts.exerciseId, exercises.id))
      .orderBy(asc(workouts.date)),
    db.select({ workoutId: workoutSets.workoutId, durationSeconds: workoutSets.durationSeconds }).from(workoutSets),
  ]);

  const setSecondsByWorkoutId = new Map<number, number>();
  for (const s of setDurations) {
    if (s.durationSeconds === null) continue;
    setSecondsByWorkoutId.set(s.workoutId, (setSecondsByWorkoutId.get(s.workoutId) ?? 0) + s.durationSeconds);
  }

  return rows.map((r) => ({
    date: r.date,
    category: r.category,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName,
    subtype: r.subtype,
    hours: r.durationMinutes !== null ? r.durationMinutes / 60 : (setSecondsByWorkoutId.get(r.id) ?? 0) / 3600,
  }));
}

// --- Place leaderboard ---------------------------------------------------

export type { PlaceLeaderboardEntry } from "@/lib/place-leaderboard";

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
// convention just below.
const rootPlaces = alias(places, "root_places");

/** Every logged place, ranked by slot-weighted mentions (legacy
 * `location_leaderboard`'s 2x-slot-1 / 1x-slot-2 scheme), with its
 * ancestor path and week/month/year rank movement (#115). No top-N limit
 * any more: the page's own "Show" control picks how many rows to draw,
 * and a few hundred places is a small payload. The ranking itself is
 * `buildPlaceLeaderboard`'s job — see src/lib/place-leaderboard.ts for why
 * it's no longer a GROUP BY. */
export async function getPlaceLeaderboardData(): Promise<PlaceLeaderboardEntry[]> {
  const db = getDb();
  const [dayRows, catalog] = await Promise.all([
    db
      .select({ date: days.date, place1Id: days.place1Id, place2Id: days.place2Id })
      .from(days)
      .where(or(isNotNull(days.place1Id), isNotNull(days.place2Id))),
    db
      .select({ id: places.id, name: places.name, idPath: places.idPath, rootColor: rootPlaces.color })
      .from(places)
      .leftJoin(rootPlaces, sql`${rootPlaces.id} = nullif(split_part(${places.idPath}, '/', 1), '')::int`),
  ]);
  return buildPlaceLeaderboard(dayRows, catalog);
}

// --- Happiness trend --------------------------------------------------

export type HappinessTrendDay = {
  date: string;
  happiness: number;
  /** `days.dayType`, or null when it wasn't recorded. Powers
   * HappinessTrendChart's work-day/other-days split (#410) — the legacy
   * "Averager" pattern (functions/views/vis/charts/happiness_averager.js)
   * binned by day-type too; an earlier pass at this chart (#18) left it out
   * "since it'd need a second grouping dimension this first pass doesn't
   * have a UI for yet" (TrendExplorer's `extraSeries`, added for #403's
   * sleep-naps split, is that UI). */
  dayType: DayType | null;
};

/** Daily happiness (with day-type), oldest first — the raw-daily
 * counterpart to what used to be server-side monthly bucketing
 * (`getHappinessAveragerData`/`MonthlyAverage`, since replaced): binning
 * moved client-side into `TrendExplorer` (`src/lib/viz/bin.ts`) once the
 * period picker and work-day split both needed to re-bucket on demand
 * rather than at a single fixed month grain. */
export async function getHappinessTrendData(): Promise<HappinessTrendDay[]> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date, happiness: days.happiness, dayType: days.dayType })
    .from(days)
    .where(isNotNull(days.happiness))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ date: r.date, happiness: r.happiness as number, dayType: r.dayType }));
}

// --- People network ---------------------------------------------------

/** Every logged day's distinct people, plus the catalog rows for anyone
 * who appears — the raw material the people network builds its graph
 * from *in the browser* (src/lib/people-network.ts), not a finished
 * graph. The network's period, mention floor, and strictness controls all
 * change which nodes exist and which edges pass the significance test, and
 * recomputing that client-side makes them instant rather than a server
 * round-trip per click.
 *
 * Unpivoted in JS rather than SQL — the 10 slots are 10 separate FK
 * columns (see schema.ts), not rows in a table, so there's nothing to
 * GROUP BY — and `days` is only ~4k rows, cheap to pull whole. The
 * payload stays small for the same reason (~3.5k days of at most ten ids).
 * The three negative slots are included alongside the seven positive ones:
 * someone logged as a bad influence on a day was still *there* that day,
 * which is all a co-occurrence graph asks. Days with nobody logged are
 * dropped here; they carry no information about who's seen together, and
 * the significance test's N is "days with someone logged". */
export async function getPeopleNetworkData(): Promise<PeopleNetworkInput> {
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
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
    .from(days)
    .orderBy(asc(days.date));

  const networkDays: PeopleNetworkDay[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const ids = [row.p1, row.p2, row.p3, row.p4, row.p5, row.p6, row.p7, row.n1, row.n2, row.n3].filter(
      (id): id is number => id !== null,
    );
    if (ids.length === 0) continue;
    const unique = [...new Set(ids)];
    for (const id of unique) seen.add(id);
    networkDays.push({ date: row.date, people: unique });
  }

  if (seen.size === 0) return { days: [], people: [] };

  // Left-joined for the tag: the network colours each person by their tag,
  // same as everywhere else a person shows up tagged, and the legend
  // toggles people by it. An untagged person (or a tag with no colour)
  // falls back to a neutral colour at the call site, not here.
  const peopleRows = await db
    .select({ id: people.id, name: people.name, tagId: tags.id, tagName: tags.name, color: tags.color })
    .from(people)
    .leftJoin(tags, eq(people.tagId, tags.id))
    .where(inArray(people.id, [...seen]));

  return { days: networkDays, people: peopleRows };
}

// --- Country visits (world choropleth, #24) -------------------------------

export type CountryVisitEntry = {
  country: string;
  days: number;
  /** Earliest logged day in this country ("YYYY-MM-DD"), or null for a
   * caller that doesn't fetch it (e.g. a test fixture) — a plain
   * `Math.min` over the day rows already read above (#370), not a second
   * query. Optional rather than always-present so existing callers that
   * only care about `days` don't have to thread a value through. */
  firstVisited?: string | null;
};

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
  // Earliest date per country — a plain min over the same deduped pairs
  // the count above reads, since a "YYYY-MM-DD" string sorts correctly
  // under `<` (see src/lib/date.ts's own convention).
  const firstVisited = new Map<string, string>();
  for (const pair of dayCountryPairs) {
    const [date, rawCountry] = pair.split("\0");
    const country = normalizeCountryName(rawCountry);
    counts.set(country, (counts.get(country) ?? 0) + 1);
    const prev = firstVisited.get(country);
    if (!prev || date < prev) firstVisited.set(country, date);
  }

  return [...counts.entries()]
    .map(([country, dayCount]) => ({ country, days: dayCount, firstVisited: firstVisited.get(country) ?? null }))
    .sort((a, b) => b.days - a.days);
}

// --- US state visits (state choropleth, #287) -----------------------------

export type UsStateVisitEntry = {
  state: string;
  days: number;
  /** Earliest logged day in this state — same "Math.min over rows already
   * fetched" reasoning as CountryVisitEntry's own field above (#370). */
  firstVisited?: string | null;
};

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
  const firstVisited = new Map<string, string>();
  for (const pair of dayStatePairs) {
    const [date, state] = pair.split("\0");
    counts.set(state, (counts.get(state) ?? 0) + 1);
    const prev = firstVisited.get(state);
    if (!prev || date < prev) firstVisited.set(state, date);
  }

  return [...counts.entries()]
    .map(([state, dayCount]) => ({ state, days: dayCount, firstVisited: firstVisited.get(state) ?? null }))
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
  /** Earliest logged day in this county — same reasoning as
   * CountryVisitEntry's own field (#370); the metro tier rolls this up
   * client-side from its member counties rather than a second query, the
   * same way it already rolls up `days`. */
  firstVisited?: string | null;
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
  const firstVisited = new Map<string, string>();
  for (const pair of dayCountyPairs) {
    const [date, fips] = pair.split("\0");
    counts.set(fips, (counts.get(fips) ?? 0) + 1);
    const prev = firstVisited.get(fips);
    if (!prev || date < prev) firstVisited.set(fips, date);
  }

  return {
    counties: [...counts.entries()]
      .map(([fips, dayCount]) => ({
        fips,
        name: nameByFips.get(fips) ?? fips,
        days: dayCount,
        firstVisited: firstVisited.get(fips) ?? null,
      }))
      .sort((a, b) => b.days - a.days),
    unresolvedDays: unresolvedDayPlacePairs.size,
  };
}

// --- Non-US subdivision visits (world map expansion, #304) ----------------

export type AdminRegionVisitEntry = {
  /** world-atlas country id — the key the world map expands by, and
   * ADMIN_REGIONS' own key. */
  countryId: string;
  /** The subdivision's feature name in the committed geometry — also its
   * join key, see AdminRegionProperties. */
  region: string;
  days: number;
  firstVisited: string | null;
};

export type AdminRegionVisitData = {
  regions: AdminRegionVisitEntry[];
  /** Per country, days logged there that landed in none of its
   * subdivisions — a place (and every ancestor of it) with no
   * coordinates, or coordinates outside every polygon. Surfaced for the
   * same reason UsCountyVisitData.unresolvedDays is: so a country's
   * subdivisions summing to less than the country itself is explained on
   * the page rather than discovered. Keyed by world-atlas country id. */
  unresolved: { countryId: string; days: number }[];
};

/**
 * Distinct days logged in each subdivision of every country with geometry
 * in ADMIN_REGIONS (#304) — the data behind clicking Turkey, France, Japan
 * and the rest on /charts/world. Same "was I there that day" dedup as every
 * other choropleth in this file.
 *
 * Resolution is spatial, like getUsCountyVisitData's, not a namePath walk
 * like getUsStateVisitData's — see admin-regions.ts for the measurement
 * that decided it, and resolveAdminRegion for the ancestor fallback that
 * catches places logged without an address. The *country* still comes from
 * the catalog (the idPath root, as in getCountryVisitData), so a place
 * geocoded across a border counts in the country it was filed under and
 * simply resolves to no subdivision there, rather than quietly moving a
 * day between countries the base map has already counted.
 *
 * Cost: point-in-polygon for each referenced non-US place against its own
 * country's subdivisions only (never the whole world's), a few hundred
 * places against at most a couple of hundred polygons. The geometry is
 * decoded once per process — see loadAdminRegionFeatures.
 */
export async function getAdminRegionVisitData(): Promise<AdminRegionVisitData> {
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
  if (referencedIds.size === 0) return { regions: [], unresolved: [] };

  const referenced = await db
    .select({ id: places.id, idPath: places.idPath })
    .from(places)
    .where(inArray(places.id, [...referencedIds]));

  // Every place on any referenced place's path — the roots, to name the
  // country, and the ancestors in between, whose coordinates are the
  // fallback when a place's own don't land.
  const pathIdsByPlace = new Map<number, number[]>();
  const pathIds = new Set<number>();
  for (const p of referenced) {
    const ids = (p.idPath ?? "").split("/").filter(Boolean).map(Number);
    if (ids.length === 0) continue;
    pathIdsByPlace.set(p.id, ids);
    for (const id of ids) pathIds.add(id);
  }
  const pathRows = pathIds.size
    ? await db
        .select({ id: places.id, name: places.name, lat: places.lat, lng: places.lng })
        .from(places)
        .where(inArray(places.id, [...pathIds]))
    : [];
  const pathById = new Map(pathRows.map((r) => [r.id, r]));

  // Resolved once per place, not once per (day, place) pair, for the same
  // reason getUsCountyVisitData does it that way.
  const countryByPlaceId = new Map<number, string>();
  const regionByPlaceId = new Map<number, string>();
  for (const [placeId, ids] of pathIdsByPlace) {
    const root = pathById.get(ids[0]);
    const countryId = root ? resolveCountryCode(root.name)?.code : undefined;
    if (!countryId || !hasAdminRegions(countryId)) continue;
    countryByPlaceId.set(placeId, countryId);

    // Own point first, then each ancestor's nearest-first, never the
    // country's own (a country-level point says nothing about which
    // subdivision a day was in).
    const points: [number, number][] = [];
    for (const id of ids.slice(1).reverse()) {
      const node = pathById.get(id);
      if (node?.lat != null && node.lng != null) points.push([node.lng, node.lat]);
    }
    if (points.length === 0) continue;
    const features = await loadAdminRegionFeatures(countryId);
    const region = features ? resolveAdminRegion(features.features, points) : null;
    if (region) regionByPlaceId.set(placeId, region);
  }

  const dayRegionPairs = new Set<string>();
  const dayCountryPairs = new Set<string>();
  const resolvedDayCountryPairs = new Set<string>();
  for (const row of dayRows) {
    for (const placeId of [row.place1Id, row.place2Id]) {
      if (placeId === null) continue;
      const countryId = countryByPlaceId.get(placeId);
      if (!countryId) continue;
      dayCountryPairs.add(`${row.date}\0${countryId}`);
      const region = regionByPlaceId.get(placeId);
      if (!region) continue;
      dayRegionPairs.add(`${row.date}\0${countryId}\0${region}`);
      resolvedDayCountryPairs.add(`${row.date}\0${countryId}`);
    }
  }

  const counts = new Map<string, number>();
  const firstVisited = new Map<string, string>();
  for (const pair of dayRegionPairs) {
    const date = pair.slice(0, pair.indexOf("\0"));
    const key = pair.slice(date.length + 1);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const prev = firstVisited.get(key);
    if (!prev || date < prev) firstVisited.set(key, date);
  }

  // A day counts as unresolved only when *nothing* that day placed it in a
  // subdivision of that country — a day with one resolved place and one
  // unresolved one is already on the map.
  const unresolved = new Map<string, number>();
  for (const pair of dayCountryPairs) {
    if (resolvedDayCountryPairs.has(pair)) continue;
    const countryId = pair.slice(pair.indexOf("\0") + 1);
    unresolved.set(countryId, (unresolved.get(countryId) ?? 0) + 1);
  }

  return {
    regions: [...counts.entries()]
      .map(([key, dayCount]) => {
        const [countryId, region] = key.split("\0");
        return { countryId, region, days: dayCount, firstVisited: firstVisited.get(key) ?? null };
      })
      .sort((a, b) => b.days - a.days),
    unresolved: [...unresolved.entries()].map(([countryId, dayCount]) => ({ countryId, days: dayCount })),
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
export type CityHeatmapNeighborhood = {
  root: string;
  name: string;
  days: number;
  /** Earliest logged day resolving to this neighborhood — same
   * `Math.min`-over-fetched-rows reasoning as CountryVisitEntry's own
   * field (#370). */
  firstVisited: string | null;
};
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
  const firstVisitedByNeighborhood = new Map<string, string>();
  for (const pair of dayNeighborhoodPairs) {
    const [date, ...rest] = pair.split("\0");
    const resolvedKey = rest.join("\0");
    neighborhoodCounts.set(resolvedKey, (neighborhoodCounts.get(resolvedKey) ?? 0) + 1);
    const prev = firstVisitedByNeighborhood.get(resolvedKey);
    if (!prev || date < prev) firstVisitedByNeighborhood.set(resolvedKey, date);
  }
  const neighborhoods = [...neighborhoodCounts.entries()].map(([resolvedKey, dayCount]) => ({
    ...splitResolvedKey(resolvedKey),
    days: dayCount,
    firstVisited: firstVisitedByNeighborhood.get(resolvedKey) ?? null,
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
 * where only one was recorded. `instagramMinutes` is a *subset* of
 * `phoneMinutes`, not an independent total — it wasn't tracked at all
 * before 2025 (null on those days), and even once tracked it should never
 * be added on top of phone time, only broken out of it (see #326). */
export type DeviceDay = {
  date: string;
  phoneMinutes: number | null;
  laptopMinutes: number | null;
  instagramMinutes: number | null;
};

/** Days with at least one device recorded, oldest first. */
export async function getDeviceUsageData(): Promise<DeviceDay[]> {
  const db = getDb();
  const rows = await db
    .select({
      date: days.date,
      phoneMinutes: days.phoneUsageMinutes,
      laptopMinutes: days.laptopUsageMinutes,
      instagramMinutes: days.instagramUsageMinutes,
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

/**
 * Instagram following count per day — `days.instagramFollowing`'s own
 * series, tracked alongside followers but never previously surfaced (#331).
 * Same cumulative-running-total shape and caveats as
 * `getInstagramFollowersData`.
 */
export function getInstagramFollowingData(): Promise<DailyValue[]> {
  return dailyValuesOf(days.instagramFollowing);
}

// --- Subs (#120) -----------------------------------------------------------

/**
 * A day's nine sub scores (0–10), index-aligned with `SUB_NAMES` from
 * `@/lib/days`. `null` means that sub was left blank that day — not
 * logged, which is different from a logged zero (the entry form's "fill
 * blanks with 0" button exists precisely because those are different
 * acts), so charts must skip a blank rather than average it in as 0.
 *
 * One row per day with every sub on it, rather than nine separate
 * `DailyValue[]` series: the subs calendar needs all nine side by side to
 * blend a day's colour, and the line charts split the row per sub
 * client-side, which is cheap at one row per day.
 */
export type SubsDay = { date: string; values: (number | null)[] };

/** Days with at least one sub logged, oldest first. */
export async function getSubsDailyData(): Promise<SubsDay[]> {
  const db = getDb();
  // Same column order as SUB_NAMES — ["A", "W", "C", "L", "Ni", "NO", "Ad",
  // "D", "K"]. Spelled out rather than derived, because `days.ts` keeps its
  // own name->column list private; recap-subs.ts makes the same call.
  const columns = [
    days.subA,
    days.subW,
    days.subC,
    days.subL,
    days.subNi,
    days.subNO,
    days.subAd,
    days.subD,
    days.subK,
  ] as const;
  const rows = await db
    .select({
      date: days.date,
      a: columns[0],
      w: columns[1],
      c: columns[2],
      l: columns[3],
      ni: columns[4],
      no: columns[5],
      ad: columns[6],
      d: columns[7],
      k: columns[8],
    })
    .from(days)
    .where(or(...columns.map((column) => isNotNull(column))))
    .orderBy(asc(days.date));
  return rows.map((r) => ({ date: r.date, values: [r.a, r.w, r.c, r.l, r.ni, r.no, r.ad, r.d, r.k] }));
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
