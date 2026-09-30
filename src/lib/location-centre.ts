import { addDays, daysBetween } from "@/lib/date";
import {
  fromUnitVector,
  greatCircleKm,
  sphericalGeometricMedian,
  toUnitVector,
  type LngLat,
  type WeightedPoint,
} from "@/lib/viz/geo-centre";

// "Where was my life centred, and how did that move?" (#215) — the pure
// half of /charts/location-centre, split from the DB fetch in charts.ts
// the way life-timeline.ts is, so the method is testable without a
// database.
//
// Legacy's `location_center_of_mass` took one plain mean of lat/lng per
// period, which the owner called "useless": a year split between two
// cities averaged to a single point in the sea, and averaging degrees is
// wrong near the antimeridian anyway.
//
// How this got here: #215's reviewed proposal plotted each period's
// biggest "base"; the owner then asked for The Economist's "Catholic
// centre of gravity" feel, which shipped first as a per-year geometric
// median. That snapped to whichever city held most of a year's days, so
// the line only ever hopped between moves and holidays. The owner's
// feedback (2026-09-30) was that it should *track* location and travel —
// so the centre is now a **rolling centre of mass**: the average position
// of the days in a moving window, sampled densely enough to draw as one
// continuous trail. A trip pulls the trail out towards the destination and
// it drifts back afterwards; a move makes it glide to the new city. The
// window length is the reader's choice — a week follows nearly every
// trip, a year gives the slow drift the inspiration chart shows.
//
// The rules that survived from the reviewed proposal:
//
// 1. **One vote per day.** A day's place slots share one vote between the
//    places that can be located — ½ each when both can, the whole vote
//    when only one can (or both slots name the same place). A two-place
//    day is never worth more than a one-place day.
// 2. **Coordinates** are the place's own geocode, else the nearest
//    ancestor's, but never a country's or a state's: their geocode is a
//    centroid (the middle of Anatolia for "Turkey"), a place nobody has
//    stood. A day that can only be placed that coarsely isn't located.
// 3. **Spherical maths throughout.** Each vote is a 3D unit vector; a
//    window's centre is the direction of their weighted sum — the true
//    centre of mass on the globe, correct across the antimeridian.
// 4. **Bases** — metros (`places.metroId`), else greedy 50 km clusters —
//    are drawn beneath the trail as the places it's being pulled between,
//    each at its own geometric median.
// 5. **Thin windows break the line** instead of being plotted
//    confidently: a window needs a quarter of its days located.

/** Radius of a fallback (non-metro) base, and how close the trail must be
 * to a base for a tooltip to say it's *in* it. A first guess, per #215 —
 * metros are the primary grouping and this only catches what they don't. */
export const BASE_RADIUS_KM = 50;

/** Share of a window's days that must be located for it to get a point;
 * below that the trail breaks (bridged by a dashed line). */
export const MIN_WINDOW_COVERAGE = 0.25;

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
  position: LngLat;
  /** Located-day votes that fell in this base during the period. */
  days: number;
  /** days / the period's located days. */
  share: number;
};

export type CentrePeriod = {
  /** "all" or "YYYY". */
  period: string;
  /** Days in the period with at least one place logged. */
  placedDays: number;
  /** Of those, days with at least one place that could be located. */
  locatedDays: number;
  /** Largest first. */
  bases: CentreBase[];
};

/** One located day as the weighted sum of its votes' unit vectors — a
 * vector of length ≤ 1 (exactly 1 when its places coincide). A tuple, not
 * an object: this is the one per-day payload that crosses to the client,
 * and ~4,000 of them are sent. Rounded to 5 decimals (~60 m). */
export type DailyVector = [date: string, x: number, y: number, z: number];

export type LocationCentreData = {
  daily: DailyVector[];
  all: CentrePeriod;
  /** Every calendar year from the first located day to the last. */
  years: CentrePeriod[];
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
  // Global, not per period, so a base is the same base (same key and
  // label) in every year it appears in.
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

  // --- 3. Per-period bases and coverage --------------------------------
  const summarise = (period: string, periodVotes: Vote[], placedDays: number): CentrePeriod => {
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
        position,
        days,
        share: locatedDays > 0 ? days / locatedDays : 0,
      });
    }
    bases.sort((a, b) => b.days - a.days || a.key.localeCompare(b.key));
    return { period, placedDays, locatedDays, bases };
  };

  const all = summarise("all", votes, placedDates.length);
  const years: CentrePeriod[] = [];
  if (votes.length > 0) {
    const locatedYears = votes.map((v) => Number(v.date.slice(0, 4)));
    for (let y = Math.min(...locatedYears); y <= Math.max(...locatedYears); y++) {
      const prefix = `${y}-`;
      years.push(
        summarise(
          String(y),
          votes.filter((v) => v.date.startsWith(prefix)),
          placedDates.filter((d) => d.startsWith(prefix)).length,
        ),
      );
    }
  }

  // --- 4. Daily vectors for the trail ------------------------------------
  const dailySum = new Map<string, [number, number, number]>();
  for (const v of votes) {
    const [x, y, z] = toUnitVector(v.position);
    const sum = dailySum.get(v.date) ?? [0, 0, 0];
    dailySum.set(v.date, [sum[0] + x * v.weight, sum[1] + y * v.weight, sum[2] + z * v.weight]);
  }
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  const daily: DailyVector[] = [...dailySum.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, [x, y, z]]) => [date, round(x), round(y), round(z)]);

  return { daily, all, years };
}

/** Sums votes at the same position into one weighted point — thousands
 * of days at a handful of places become a handful of points, which is
 * what keeps each base's median cheap. */
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

// --- Trail ------------------------------------------------------------------

export type TrailPoint = {
  /** The window's middle day. */
  date: string;
  position: LngLat;
  /** Located days inside the window. */
  days: number;
};

/**
 * The rolling centre of mass: for a sample every `stepDays`, the direction
 * of the summed day vectors within `windowDays` centred on it.
 *
 * Centred rather than trailing, so the trail's excursion towards a trip
 * peaks on the trip's own dates instead of a half-window after them.
 * Prefix sums make every window O(1), so switching window length on the
 * client is instant even at a 7-day window over a decade of days.
 *
 * Returns runs of consecutive points. A new run starts wherever a window
 * has less than MIN_WINDOW_COVERAGE of its days located — a stretch with
 * too little logged to say where the centre was.
 */
export function rollingTrail(daily: DailyVector[], windowDays: number, stepDays: number): TrailPoint[][] {
  if (daily.length === 0) return [];
  const first = daily[0][0];
  const span = daysBetween(first, daily[daily.length - 1][0]) + 1;
  // prefix[i] = sums over days [0, i)
  const px = new Float64Array(span + 1);
  const py = new Float64Array(span + 1);
  const pz = new Float64Array(span + 1);
  const pn = new Float64Array(span + 1);
  const at = new Map(daily.map((d) => [d[0], d]));
  for (let i = 0; i < span; i++) {
    const d = at.get(addDays(first, i));
    px[i + 1] = px[i] + (d?.[1] ?? 0);
    py[i + 1] = py[i] + (d?.[2] ?? 0);
    pz[i + 1] = pz[i] + (d?.[3] ?? 0);
    pn[i + 1] = pn[i] + (d ? 1 : 0);
  }

  const half = Math.floor(windowDays / 2);
  const minDays = Math.max(1, Math.ceil(windowDays * MIN_WINDOW_COVERAGE));
  const runs: TrailPoint[][] = [];
  let run: TrailPoint[] = [];
  for (let i = 0; i < span; i += stepDays) {
    // Clamped at the ends of the record, so the first and last points use
    // a half-window rather than being dropped.
    const lo = Math.max(0, i - half);
    const hi = Math.min(span, lo + windowDays);
    const n = pn[hi] - pn[lo];
    const position =
      n >= minDays ? fromUnitVector([px[hi] - px[lo], py[hi] - py[lo], pz[hi] - pz[lo]]) : null;
    if (!position) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push({ date: addDays(first, i), position, days: n });
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * Groups labelled points that sit within `mergeKm` of each other, so one
 * spot visited in several periods gets one dot and one label ("2016–2018,
 * 2021") instead of labels stacked on top of each other. Points are in
 * time order; runs of consecutive indices are joined with an en dash.
 */
export function mergeNearbyLabels<T extends { position: LngLat; label: string }>(
  points: T[],
  mergeKm: number,
): { position: LngLat; label: string; members: T[] }[] {
  const groups: { position: LngLat; indices: number[] }[] = [];
  points.forEach((p, i) => {
    const group = groups.find((g) => greatCircleKm(g.position, p.position) <= mergeKm);
    if (group) group.indices.push(i);
    else groups.push({ position: p.position, indices: [i] });
  });
  return groups.map((g) => {
    const runs: string[] = [];
    let start = 0;
    for (let k = 1; k <= g.indices.length; k++) {
      if (k < g.indices.length && g.indices[k] === g.indices[k - 1] + 1) continue;
      const from = points[g.indices[start]].label;
      const to = points[g.indices[k - 1]].label;
      runs.push(start === k - 1 ? from : `${from}–${to}`);
      start = k;
    }
    return { position: g.position, label: runs.join(", "), members: g.indices.map((i) => points[i]) };
  });
}
