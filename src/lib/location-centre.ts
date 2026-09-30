import { greatCircleKm, sphericalGeometricMedian, type LngLat, type WeightedPoint } from "@/lib/viz/geo-centre";

// "Where was my life centred, and how did that move?" (#215) — the pure
// half of /charts/location-centre, split from the DB fetch in charts.ts
// the way life-timeline.ts is, so the method is testable without a
// database.
//
// Legacy's `location_center_of_mass` took a plain mean of lat/lng, which
// the owner called "useless": a year split between two cities averaged to
// a point in the sea, one trip dragged it hundreds of kilometres, and
// averaging degrees is wrong near the antimeridian anyway. The method here
// was proposed and reviewed on #215 before being built, with one later
// change from the owner (2026-09-30): the centre is the **median of all of
// a period's days**, plotted as a path over time like The Economist's
// "Catholic centre of gravity", rather than only ever the biggest base.
//
// 1. **One vote per day.** A day's place slots share one vote between the
//    places that can be located — ½ each when both can, the whole vote
//    when only one can (or both slots name the same place). A two-place
//    day is never worth more than a one-place day.
// 2. **Coordinates** are the place's own geocode, else the nearest
//    ancestor's, but never a country's or a state's: their geocode is a
//    centroid (the middle of Anatolia for "Turkey"), which is precisely
//    the invented location this chart exists to avoid. A day that can only
//    be placed that coarsely is counted as not located.
// 3. **Centre** = the weighted geometric median of every located day in
//    the period (see sphericalGeometricMedian). With a majority in one area
//    it sits in that area; only a period with no majority can put it
//    between places, and the chart then says how far it is from the
//    nearest one rather than pretending it's somewhere lived in.
// 4. **Bases** — the places the median is weighing up — are drawn beneath
//    the path so it's visible what pulled it where. A base is a metro
//    (`places.metroId`, hand-curated "same area") or, for places in no
//    metro, a greedy 50 km cluster.
// 5. **Sparse periods** are flagged rather than plotted confidently: fewer
//    than 30 located days for a year or 10 for a month, following the
//    recap's "not enough data" convention (#169).
//
// A different centre definition — The Economist's own, the separate
// median latitude and median longitude ("equal numbers north, south, east
// and west") — is kept open as a follow-up rather than built alongside.

/** Radius of a fallback (non-metro) base, and how far the centre may sit
 * from every base before it's reported as "between places". A first
 * guess, per #215 — metros are the primary grouping and this only
 * catches what they don't. */
export const BASE_RADIUS_KM = 50;

/** Minimum located days before a period gets a centre at all (#215 §5). */
export const MIN_LOCATED_DAYS = { year: 30, month: 10 } as const;

/** Path stops closer than this are drawn as one dot with a combined
 * label. Consecutive years at home land a few km apart; drawing each as
 * its own dot would stack their labels on top of each other. */
export const STOP_MERGE_KM = 25;

// Region subcategories whose geocode is an area's centroid rather than a
// place anyone has stood — see point 2 above.
const TOO_COARSE_SUBCATEGORIES = new Set(["Country", "State/Province"]);

export type CentreDay = { date: string; place1Id: number | null; place2Id: number | null };

export type CentrePlace = {
  id: number;
  name: string;
  /** "<id>/<id>/.../<id>/" root to self; null until backfilled. */
  idPath: string | null;
  category: string | null;
  subcategory: string | null;
  metroId: number | null;
  lat: number | null;
  lng: number | null;
};

export type CentreMetro = { id: number; name: string; country: string | null };

export type CentreBase = {
  key: string;
  label: string;
  /** Country, for a tooltip's second line. */
  context: string | null;
  /** Rank by all-time days, so a base keeps one colour in every period —
   * never re-ranked per period (categorical colours are fixed by index in
   * this app; see categoricalColor). */
  colorIndex: number;
  position: LngLat;
  /** Located-day votes that fell in this base during the period. */
  days: number;
  /** days / the period's located days. */
  share: number;
};

export type CentrePeriod = {
  /** "all", "YYYY", or "YYYY-MM". */
  period: string;
  /** Days in the period with at least one place logged. */
  placedDays: number;
  /** Of those, days with at least one place that could be located. */
  locatedDays: number;
  /** Below MIN_LOCATED_DAYS: bases are still listed, but there's no centre. */
  sparse: boolean;
  centre: LngLat | null;
  /** The base closest to the centre, and how far away it is. More than
   * BASE_RADIUS_KM means the centre sits between places. */
  nearestBase: { key: string; label: string; km: number } | null;
  /** Largest first. */
  bases: CentreBase[];
};

export type LocationCentreData = {
  all: CentrePeriod;
  /** Every calendar year from the first located day to the last, in
   * order — including empty ones, so adjacency in this list is adjacency
   * in time. */
  years: CentrePeriod[];
  /** Every month of every year in `years`, in order. */
  months: CentrePeriod[];
};

/** One located vote: part of a day, at a position, in a base. */
type Vote = { date: string; position: LngLat; weight: number; baseKey: string };

export function buildLocationCentreData(
  dayRows: CentreDay[],
  catalog: CentrePlace[],
  metroRows: CentreMetro[],
): LocationCentreData {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const metroById = new Map(metroRows.map((m) => [m.id, m]));

  /** Root-to-self chain. `idPath` rather than `namePath`, since a place
   * name can itself contain "/" (same reasoning as the place leaderboard). */
  const chainOf = (place: CentrePlace): CentrePlace[] => {
    if (!place.idPath) return [place];
    const chain = place.idPath
      .split("/")
      .filter(Boolean)
      .map((id) => byId.get(Number(id)))
      .filter((p): p is CentrePlace => p !== undefined);
    return chain.length > 0 ? chain : [place];
  };

  const isTooCoarse = (p: CentrePlace) =>
    p.category === "Region" && p.subcategory != null && TOO_COARSE_SUBCATEGORIES.has(p.subcategory);

  /** Nearest ancestor-or-self with a usable geocode, or null. Stops at the
   * first coordinate-bearing ancestor even if it's too coarse — skipping
   * past a state to the country above it would only be coarser still. */
  const locationCache = new Map<number, LngLat | null>();
  const locate = (placeId: number): LngLat | null => {
    if (locationCache.has(placeId)) return locationCache.get(placeId)!;
    const place = byId.get(placeId);
    let found: LngLat | null = null;
    if (place) {
      for (const p of [...chainOf(place)].reverse()) {
        if (p.lat == null || p.lng == null) continue;
        found = isTooCoarse(p) ? null : [p.lng, p.lat];
        break;
      }
    }
    locationCache.set(placeId, found);
    return found;
  };

  /** Metro via the nearest ancestor-or-self that has one — metros are set
   * at the municipality tier, so everything beneath a city inherits it. */
  const metroOf = (placeId: number): number | null => {
    const place = byId.get(placeId);
    if (!place) return null;
    return [...chainOf(place)].reverse().find((p) => p.metroId !== null)?.metroId ?? null;
  };

  // --- 1. Votes, before bases are known --------------------------------
  type RawVote = { date: string; placeId: number; position: LngLat; weight: number };
  const rawVotes: RawVote[] = [];
  const placedDates: string[] = [];
  for (const day of dayRows) {
    const ids = [...new Set([day.place1Id, day.place2Id].filter((id): id is number => id !== null))];
    if (ids.length === 0) continue;
    placedDates.push(day.date);
    const located = ids.map((id) => ({ id, position: locate(id) })).filter((x) => x.position !== null);
    for (const { id, position } of located) {
      rawVotes.push({ date: day.date, placeId: id, position: position!, weight: 1 / located.length });
    }
  }

  // --- 2. Bases ---------------------------------------------------------
  // Global, not per period, so a base is the same base (same key, label
  // and colour) in every year it appears in.
  const totalByPlace = new Map<number, { position: LngLat; weight: number }>();
  for (const v of rawVotes) {
    const entry = totalByPlace.get(v.placeId);
    if (entry) entry.weight += v.weight;
    else totalByPlace.set(v.placeId, { position: v.position, weight: v.weight });
  }

  const baseKeyByPlace = new Map<number, string>();
  const baseMeta = new Map<string, { label: string; context: string | null }>();
  const countryOf = (placeId: number) => {
    const place = byId.get(placeId);
    return place ? chainOf(place)[0].name : null;
  };

  const unmetro: { id: number; position: LngLat; weight: number }[] = [];
  for (const [id, { position, weight }] of totalByPlace) {
    const metroId = metroOf(id);
    const metro = metroId !== null ? metroById.get(metroId) : undefined;
    if (metro) {
      const key = `metro:${metro.id}`;
      baseKeyByPlace.set(id, key);
      if (!baseMeta.has(key)) baseMeta.set(key, { label: metro.name, context: metro.country ?? countryOf(id) });
    } else {
      unmetro.push({ id, position, weight });
    }
  }

  // Greedy clustering for everything outside a metro: the most-visited
  // unassigned place seeds a base, and takes every unassigned place within
  // BASE_RADIUS_KM of it. A fixed radius rather than DBSCAN's two knobs —
  // at a few hundred places there's nothing to gain from density
  // estimation, and "within 50 km" is easy to reason about.
  unmetro.sort((a, b) => b.weight - a.weight || a.id - b.id);
  for (const seed of unmetro) {
    if (baseKeyByPlace.has(seed.id)) continue;
    const key = `near:${seed.id}`;
    baseMeta.set(key, { label: clusterLabel(seed.id), context: countryOf(seed.id) });
    for (const other of unmetro) {
      if (baseKeyByPlace.has(other.id)) continue;
      if (greatCircleKm(seed.position, other.position) <= BASE_RADIUS_KM) baseKeyByPlace.set(other.id, key);
    }
  }

  /** A fallback base is named for the municipality its busiest place is
   * in — the level people name "where they were" at — then the state,
   * then the place itself. */
  function clusterLabel(seedId: number): string {
    const seed = byId.get(seedId)!;
    const chain = chainOf(seed);
    for (const level of ["Municipality", "State/Province"]) {
      const match = [...chain].reverse().find((p) => p.category === "Region" && p.subcategory === level);
      if (match) return match.name;
    }
    return seed.name;
  }

  const votes: Vote[] = rawVotes.map((v) => ({
    date: v.date,
    position: v.position,
    weight: v.weight,
    baseKey: baseKeyByPlace.get(v.placeId)!,
  }));

  const baseTotals = new Map<string, number>();
  for (const v of votes) baseTotals.set(v.baseKey, (baseTotals.get(v.baseKey) ?? 0) + v.weight);
  const colorIndexByBase = new Map(
    [...baseTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key], i) => [key, i]),
  );

  // --- 3. Periods -------------------------------------------------------
  const summarise = (period: string, periodVotes: Vote[], placedDays: number, minDays: number): CentrePeriod => {
    const locatedDays = new Set(periodVotes.map((v) => v.date)).size;
    const byBase = new Map<string, Vote[]>();
    for (const v of periodVotes) {
      const list = byBase.get(v.baseKey);
      if (list) list.push(v);
      else byBase.set(v.baseKey, [v]);
    }
    const bases: CentreBase[] = [];
    for (const [key, list] of byBase) {
      const days = list.reduce((sum, v) => sum + v.weight, 0);
      const position = sphericalGeometricMedian(collapse(list));
      if (!position) continue;
      bases.push({
        key,
        label: baseMeta.get(key)!.label,
        context: baseMeta.get(key)!.context,
        colorIndex: colorIndexByBase.get(key)!,
        position,
        days,
        share: locatedDays > 0 ? days / locatedDays : 0,
      });
    }
    bases.sort((a, b) => b.days - a.days || a.colorIndex - b.colorIndex);

    const sparse = locatedDays < minDays;
    const centre = sparse ? null : sphericalGeometricMedian(collapse(periodVotes));
    let nearestBase: CentrePeriod["nearestBase"] = null;
    if (centre) {
      for (const b of bases) {
        const km = greatCircleKm(centre, b.position);
        if (!nearestBase || km < nearestBase.km) nearestBase = { key: b.key, label: b.label, km };
      }
    }
    return { period, placedDays, locatedDays, sparse, centre, nearestBase, bases };
  };

  const votesByPrefix = (prefix: string) => votes.filter((v) => v.date.startsWith(prefix));
  const placedByPrefix = (prefix: string) => placedDates.filter((d) => d.startsWith(prefix)).length;

  const all = summarise("all", votes, placedDates.length, 0);
  const years: CentrePeriod[] = [];
  const months: CentrePeriod[] = [];
  if (votes.length > 0) {
    const locatedYears = votes.map((v) => Number(v.date.slice(0, 4)));
    const first = Math.min(...locatedYears);
    const last = Math.max(...locatedYears);
    for (let y = first; y <= last; y++) {
      const year = String(y);
      years.push(summarise(year, votesByPrefix(`${year}-`), placedByPrefix(`${year}-`), MIN_LOCATED_DAYS.year));
      for (let m = 1; m <= 12; m++) {
        const month = `${year}-${String(m).padStart(2, "0")}`;
        months.push(summarise(month, votesByPrefix(`${month}-`), placedByPrefix(`${month}-`), MIN_LOCATED_DAYS.month));
      }
    }
  }
  return { all, years, months };
}

/** Sums votes at the same position into one weighted point — thousands
 * of days at a handful of places become a handful of points, which is
 * what keeps the median cheap to recompute for every period. */
function collapse(votes: Vote[]): WeightedPoint[] {
  const byPos = new Map<string, WeightedPoint>();
  for (const v of votes) {
    const key = `${v.position[0]},${v.position[1]}`;
    const entry = byPos.get(key);
    if (entry) entry.weight += v.weight;
    else byPos.set(key, { position: v.position, weight: v.weight });
  }
  return [...byPos.values()];
}

// --- Path ------------------------------------------------------------------

export type PathStop = {
  id: string;
  position: LngLat;
  /** Member periods in time order, e.g. ["2019", "2020", "2023"]. */
  periods: CentrePeriod[];
};

export type PathSegment = {
  id: string;
  from: LngLat;
  to: LngLat;
  /** True when sparse periods were skipped between the two ends, so the
   * line is a gap in the data rather than a real move. */
  dashed: boolean;
};

/**
 * Turns an ordered, contiguous list of periods into dots and the lines
 * between them.
 *
 * Periods whose centres are within STOP_MERGE_KM of an existing stop join
 * it, so five years at home are one dot labelled "2016–2020" instead of
 * five dots stacked on one spot. The line still follows every period in
 * order; it just has nothing to draw while the centre stays put.
 */
export function buildPath(periods: CentrePeriod[]): { stops: PathStop[]; segments: PathSegment[] } {
  const stops: PathStop[] = [];
  const segments: PathSegment[] = [];
  let prev: PathStop | null = null;
  let skipped = false;
  for (const period of periods) {
    if (!period.centre) {
      if (prev) skipped = true;
      continue;
    }
    let stop = stops.find((s) => greatCircleKm(s.position, period.centre!) <= STOP_MERGE_KM);
    if (stop) {
      stop.periods.push(period);
    } else {
      stop = { id: period.period, position: period.centre, periods: [period] };
      stops.push(stop);
    }
    if (prev && prev !== stop) {
      segments.push({ id: `${prev.id}>${stop.id}#${segments.length}`, from: prev.position, to: stop.position, dashed: skipped });
    }
    prev = stop;
    skipped = false;
  }
  return { stops, segments };
}

/**
 * Compresses a stop's periods into a label, joining runs of adjacent
 * periods: ["2016", "2017", "2018", "2021"] -> "2016–2018, 2021".
 * Adjacency is by position in `ordered` (the contiguous list the path was
 * built from), which is why `years`/`months` include empty periods.
 */
export function formatPeriodRuns(
  members: CentrePeriod[],
  ordered: CentrePeriod[],
  format: (period: string) => string,
): string {
  const index = new Map(ordered.map((p, i) => [p.period, i]));
  const idx = members.map((p) => index.get(p.period)!).sort((a, b) => a - b);
  const runs: string[] = [];
  let start = 0;
  for (let i = 1; i <= idx.length; i++) {
    if (i < idx.length && idx[i] === idx[i - 1] + 1) continue;
    const from = format(ordered[idx[start]].period);
    const to = format(ordered[idx[i - 1]].period);
    runs.push(start === i - 1 ? from : `${from}–${to}`);
    start = i;
  }
  return runs.join(", ");
}
