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
// continuous trail. A move makes it glide to the new city, and a long
// stretch away bends it. The window length is the reader's choice, from
// one to five years — shorter windows were tried and dropped, see
// location-centre-chart.tsx.
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
// 4. **Areas** are what the trail is being pulled between, drawn beneath
//    it as circles and named in its tooltips ("most visited: Istanbul,
//    64%"): a place's metro, else its municipality (owner's call,
//    2026-09-30, replacing the reviewed 50 km clustering — a name the
//    owner already uses beats a cluster named after its busiest member).
// 5. **Thin windows break the line** instead of being plotted
//    confidently: a window needs a quarter of its days located.

/** Share of a window's days that must be located for it to get a point;
 * below that the trail breaks (bridged by a dashed line). */
export const MIN_WINDOW_COVERAGE = 0.25;

// Region subcategories whose geocode is an area's centroid rather than a
// place anyone has stood — see point 2 above. Also never used as an area:
// "most visited: Turkey" says nothing a map of Turkey doesn't.
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

export type CentreArea = {
  key: string;
  label: string;
  /** Country, for a tooltip's title. */
  context: string | null;
};

/** An area as the chart draws it: where it sits and how it ranks, both
 * over the whole record. Fixed rather than per range, so a circle never
 * moves or changes colour when the year range does — only its size
 * (share of the range's days) changes. */
export type CentreAreaSummary = CentreArea & {
  /** The area's geometric median over all its days. */
  position: LngLat;
  /** 0 = the area with the most days across the whole record. Drives
   * colour (src/lib/viz/area-colors.ts). */
  rank: number;
};

export type CentreBase = CentreAreaSummary & {
  /** Index into `LocationCentreData.areas`. */
  area: number;
  /** Located-day votes that fell in this area during the range. */
  days: number;
  /** days / the range's located days. */
  share: number;
};

/** One calendar year's coverage and per-area days — summed by
 * `rangeSummary` for whatever year range is picked. */
export type CentreYear = {
  year: number;
  /** Days in the year with at least one place logged. */
  placedDays: number;
  /** Of those, days with at least one place that could be located. */
  locatedDays: number;
  /** [area index, days] for every area with days this year. */
  areaDays: [number, number][];
};

/**
 * One located day: the weighted sum of its votes' unit vectors (length ≤ 1,
 * exactly 1 when its places coincide), then an index into
 * `LocationCentreData.areas` per located vote — each worth an equal share
 * of the day, so `[…, 3, 3]` is a whole day in area 3 and `[…, 3, 7]` half
 * each. A tuple, not an object: this is the one per-day payload that
 * crosses to the client, and ~4,000 of them are sent. Rounded to 5
 * decimals (~60 m).
 */
export type DailyVector = [date: string, x: number, y: number, z: number, ...areas: number[]];

export type LocationCentreData = {
  daily: DailyVector[];
  areas: CentreAreaSummary[];
  /** Every calendar year from the first day with a place to the last, in
   * order, including empty ones. */
  years: CentreYear[];
};

/** One located vote: part of a day, at a position, in an area. */
type Vote = { date: string; position: LngLat; weight: number; area: number };

/**
 * The shared first half of `buildLocationCentreData` and `rankAreas`:
 * every located vote, every area, and each area's all-time rank. One
 * function so the Centre of Gravity chart and every other chart coloured
 * by area (via `rankAreas`) can never disagree about which area is
 * "third" — and so about which colour it gets.
 */
function collectVotes(dayRows: CentreDay[], catalog: CentrePlace[], metroRows: CentreMetro[]) {
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
  const locate = (place: CentrePlace): LngLat | null => {
    for (const p of [...chainOf(place)].reverse()) {
      if (p.lat == null || p.lng == null) continue;
      return isTooCoarse(p) ? null : [p.lng, p.lat];
    }
    return null;
  };

  // Areas, indexed so a day can name them by number.
  const areas: CentreArea[] = [];
  const areaIndexByKey = new Map<string, number>();
  const areaIndex = (area: CentreArea) => {
    let i = areaIndexByKey.get(area.key);
    if (i === undefined) {
      i = areas.length;
      areas.push(area);
      areaIndexByKey.set(area.key, i);
    }
    return i;
  };

  /** Metro via the nearest ancestor-or-self that has one (metros are set
   * at the municipality tier, so everything beneath a city inherits it);
   * else the municipality; else the nearest region finer than a state (a
   * national park, an island); else the place itself. */
  const areaOf = (place: CentrePlace): CentreArea => {
    const chain = [...chainOf(place)].reverse();
    const country = chain[chain.length - 1].name;
    const withMetro = chain.find((p) => p.metroId !== null && metroById.has(p.metroId));
    if (withMetro) {
      const metro = metroById.get(withMetro.metroId!)!;
      return { key: `metro:${metro.id}`, label: metro.name, context: metro.country ?? country };
    }
    const area =
      chain.find((p) => p.category === "Region" && p.subcategory === "Municipality") ??
      chain.find((p) => p.category === "Region" && !isTooCoarse(p)) ??
      place;
    return { key: `place:${area.id}`, label: area.name, context: area === chain[chain.length - 1] ? null : country };
  };

  const resolved = new Map<number, { position: LngLat; area: number } | null>();
  const resolve = (placeId: number) => {
    if (resolved.has(placeId)) return resolved.get(placeId)!;
    const place = byId.get(placeId);
    const position = place ? locate(place) : null;
    const out = place && position ? { position, area: areaIndex(areaOf(place)) } : null;
    resolved.set(placeId, out);
    return out;
  };

  // --- 1. Votes ----------------------------------------------------------
  const votes: Vote[] = [];
  const placedDates: string[] = [];
  const daily: DailyVector[] = [];
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  for (const day of [...dayRows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const ids = [...new Set([day.place1Id, day.place2Id].filter((id): id is number => id !== null))];
    if (ids.length === 0) continue;
    placedDates.push(day.date);
    const located = ids.map(resolve).filter((r) => r !== null);
    if (located.length === 0) continue;
    const weight = 1 / located.length;
    let [x, y, z] = [0, 0, 0];
    for (const { position, area } of located) {
      votes.push({ date: day.date, position, weight, area });
      const [vx, vy, vz] = toUnitVector(position);
      x += vx * weight;
      y += vy * weight;
      z += vz * weight;
    }
    daily.push([day.date, round(x), round(y), round(z), ...located.map((l) => l.area)]);
  }

  // --- 2. Rank: all-time days per area -----------------------------------
  const votesByArea = new Map<number, Vote[]>();
  for (const v of votes) {
    const list = votesByArea.get(v.area);
    if (list) list.push(v);
    else votesByArea.set(v.area, [v]);
  }
  const totalDays = (area: number) => (votesByArea.get(area) ?? []).reduce((sum, v) => sum + v.weight, 0);
  const rankOrder = areas
    .map((_, i) => i)
    .sort((a, b) => totalDays(b) - totalDays(a) || areas[a].key.localeCompare(areas[b].key));
  const rankOf = new Map(rankOrder.map((area, rank) => [area, rank]));
  return { areas, votes, placedDates, daily, votesByArea, rankOf };
}

/**
 * Every area (metro, else municipality — see `areaOf`) with its all-time
 * rank by located days, most first. What `areaColorForRank` colours by:
 * the Centre of Gravity chart gets the same ranks from
 * `buildLocationCentreData`, and the Place Sunburst's and Place
 * Leaderboard's metro views read them through `getAreaColors`, so an area
 * is one colour on every chart.
 */
export function rankAreas(
  dayRows: CentreDay[],
  catalog: CentrePlace[],
  metroRows: CentreMetro[],
): (CentreArea & { rank: number })[] {
  const { areas, rankOf } = collectVotes(dayRows, catalog, metroRows);
  return areas.map((area, i) => ({ ...area, rank: rankOf.get(i)! })).sort((a, b) => a.rank - b.rank);
}

export function buildLocationCentreData(
  dayRows: CentreDay[],
  catalog: CentrePlace[],
  metroRows: CentreMetro[],
): LocationCentreData {
  const { areas, votes, placedDates, daily, votesByArea, rankOf } = collectVotes(dayRows, catalog, metroRows);

  // --- Areas' fixed position -------------------------------------------------
  const summaries: CentreAreaSummary[] = areas.map((area, i) => ({
    ...area,
    // Every area here has at least one vote (it was only created for a
    // located place), so the median always exists.
    position: sphericalGeometricMedian(collapse(votesByArea.get(i) ?? []))!,
    rank: rankOf.get(i)!,
  }));

  // --- Per-year coverage and area days ---------------------------------------
  // From the first day with a place to the last, not just the located
  // ones, so a year whose places all lack coordinates still counts in the
  // coverage readout instead of vanishing from it.
  const years: CentreYear[] = [];
  if (placedDates.length > 0) {
    const first = Number(placedDates[0].slice(0, 4));
    const last = Number(placedDates[placedDates.length - 1].slice(0, 4));
    for (let y = first; y <= last; y++) {
      const prefix = `${y}-`;
      const yearVotes = votes.filter((v) => v.date.startsWith(prefix));
      const areaDays = new Map<number, number>();
      for (const v of yearVotes) areaDays.set(v.area, (areaDays.get(v.area) ?? 0) + v.weight);
      years.push({
        year: y,
        placedDays: placedDates.filter((d) => d.startsWith(prefix)).length,
        locatedDays: new Set(yearVotes.map((v) => v.date)).size,
        areaDays: [...areaDays.entries()],
      });
    }
  }

  return { daily, areas: summaries, years };
}

/**
 * Coverage and per-area days for the years `from`–`to` inclusive, largest
 * area first — what the circles and the coverage readout show for a picked
 * year range.
 */
export function rangeSummary(
  data: LocationCentreData,
  from: number,
  to: number,
): { placedDays: number; locatedDays: number; bases: CentreBase[] } {
  let placedDays = 0;
  let locatedDays = 0;
  const days = new Map<number, number>();
  for (const y of data.years) {
    if (y.year < from || y.year > to) continue;
    placedDays += y.placedDays;
    locatedDays += y.locatedDays;
    for (const [area, d] of y.areaDays) days.set(area, (days.get(area) ?? 0) + d);
  }
  const bases: CentreBase[] = [...days.entries()]
    .map(([area, d]) => ({ ...data.areas[area], area, days: d, share: locatedDays > 0 ? d / locatedDays : 0 }))
    .sort((a, b) => b.days - a.days || a.rank - b.rank);
  return { placedDays, locatedDays, bases };
}

/** Sums votes at the same position into one weighted point — thousands
 * of days at a handful of places become a handful of points, which is
 * what keeps each area's median cheap. */
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

/** `daily` laid out by calendar offset from the first day, with prefix
 * sums, so any window's centre is O(1). Build once per `daily` and share
 * between `rollingTrail` and `windowMix`, which must agree on what a
 * window is. */
export type DailyIndex = {
  first: string;
  span: number;
  byOffset: (DailyVector | undefined)[];
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  pn: Float64Array;
};

export function indexDaily(daily: DailyVector[]): DailyIndex | null {
  if (daily.length === 0) return null;
  const first = daily[0][0];
  const span = daysBetween(first, daily[daily.length - 1][0]) + 1;
  const byOffset: (DailyVector | undefined)[] = new Array(span);
  for (const d of daily) byOffset[daysBetween(first, d[0])] = d;
  // prefix[i] = sums over offsets [0, i)
  const px = new Float64Array(span + 1);
  const py = new Float64Array(span + 1);
  const pz = new Float64Array(span + 1);
  const pn = new Float64Array(span + 1);
  for (let i = 0; i < span; i++) {
    const d = byOffset[i];
    px[i + 1] = px[i] + (d?.[1] ?? 0);
    py[i + 1] = py[i] + (d?.[2] ?? 0);
    pz[i + 1] = pz[i] + (d?.[3] ?? 0);
    pn[i + 1] = pn[i] + (d ? 1 : 0);
  }
  return { first, span, byOffset, px, py, pz, pn };
}

/** The offsets [lo, hi) of the window *ending* on offset `i` — the
 * `windowDays` up to and including that day.
 *
 * Look-back, not centred (owner's call, 2026-09-30). A centred window
 * reacts to a move while it's happening, but near the present it has no
 * future to look into and was silently cut to half its length: the
 * latest point of a "5-year" trail averaged barely 2½ years, while the
 * breakdown still said five. Looking back, a point at Aug 2026 is Aug 2021
 * to Aug 2026 and the chart's "Now" is simply "my last five years" — every
 * window is full length except in the record's first `windowDays`, where
 * there isn't yet that much history behind a point. There it's cut short
 * rather than extended forward, so it never counts days from after the
 * point it describes; the breakdown panel says when that's happened. The
 * cost is lag: a move bends the line gradually, over the window after it.
 */
function windowBounds(_index: DailyIndex, i: number, windowDays: number): [number, number] {
  return [Math.max(0, i - windowDays + 1), i + 1];
}

export type TrailPoint = {
  /** The window's last day — the point describes the window ending here. */
  date: string;
  position: LngLat;
  /** Located days inside the window. */
  days: number;
};

/**
 * The rolling centre of mass: for a sample every `stepDays`, the direction
 * of the summed day vectors in the `windowDays` ending on it (see
 * windowBounds for why the window looks back rather than being centred).
 *
 * Returns runs of consecutive points. A new run starts wherever a window
 * has less than MIN_WINDOW_COVERAGE of its days located — a stretch with
 * too little logged to say where the centre was.
 */
export function rollingTrail(index: DailyIndex | null, windowDays: number, stepDays: number): TrailPoint[][] {
  if (!index) return [];
  const { px, py, pz, pn } = index;
  const minDays = Math.max(1, Math.ceil(windowDays * MIN_WINDOW_COVERAGE));
  const runs: TrailPoint[][] = [];
  let run: TrailPoint[] = [];
  // Every stepDays from the first day, plus the last day itself, so the
  // trail always ends on the latest logged day — the chart's "Now" dot
  // sits there, and a step of up to six weeks would otherwise stop the
  // line short of it.
  const offsets: number[] = [];
  for (let i = 0; i < index.span; i += stepDays) offsets.push(i);
  if (offsets[offsets.length - 1] !== index.span - 1) offsets.push(index.span - 1);
  for (const i of offsets) {
    const [lo, hi] = windowBounds(index, i, windowDays);
    const n = pn[hi] - pn[lo];
    const position = n >= minDays ? fromUnitVector([px[hi] - px[lo], py[hi] - py[lo], pz[hi] - pz[lo]]) : null;
    if (!position) {
      if (run.length > 0) runs.push(run);
      run = [];
      continue;
    }
    run.push({ date: addDays(index.first, i), position, days: n });
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * The second-level averager (#609): each trail point replaced by a
 * Gaussian-weighted mean of the trail points around it, so the line runs
 * as a smooth curve *near* the dots rather than through each one.
 *
 * It's the same algorithm as the first level, a mean on the globe: unit
 * vectors summed with weights and turned back into a direction, so it's
 * right across the date line. Weights fall off with calendar distance
 * (`sigmaDays` is one standard deviation), and points past 3σ are skipped.
 *
 * **Within a run only.** A gap is a stretch too thin to place, and
 * smoothing across it would invent a path through it. Each run is smoothed
 * on its own, and the chart's dashed bridge still joins them.
 *
 * **Ends are pulled in.** A run's first and last points have neighbours on
 * one side only, so they shift towards the run's interior. That's why the
 * smoothed line can stop short of the Now dot, which stays at the real
 * latest position. Only the line is smoothed. The dots, tooltips and
 * breakdowns keep describing the first-level windows.
 *
 * `sigmaDays <= 0` returns the trail unchanged.
 */
export function smoothTrail(runs: TrailPoint[][], sigmaDays: number): TrailPoint[][] {
  if (!(sigmaDays > 0)) return runs;
  const reach = 3 * sigmaDays;
  return runs.map((run) => {
    const offsets = run.map((p) => daysBetween(run[0].date, p.date));
    const vectors = run.map((p) => toUnitVector(p.position));
    return run.map((p, i) => {
      let x = 0;
      let y = 0;
      let z = 0;
      // Walk outwards both ways while still within reach; the run is in
      // date order, so this stops at the first point past 3σ each side.
      for (let j = i; j >= 0 && offsets[i] - offsets[j] <= reach; j--) {
        const w = Math.exp(-((offsets[i] - offsets[j]) ** 2) / (2 * sigmaDays * sigmaDays));
        x += vectors[j][0] * w;
        y += vectors[j][1] * w;
        z += vectors[j][2] * w;
      }
      for (let j = i + 1; j < run.length && offsets[j] - offsets[i] <= reach; j++) {
        const w = Math.exp(-((offsets[j] - offsets[i]) ** 2) / (2 * sigmaDays * sigmaDays));
        x += vectors[j][0] * w;
        y += vectors[j][1] * w;
        z += vectors[j][2] * w;
      }
      return { ...p, position: fromUnitVector([x, y, z]) ?? p.position };
    });
  });
}

/** Per-area day totals within [lo, hi), and how many days were located. */
function windowTotals(index: DailyIndex, lo: number, hi: number): { totals: Map<number, number>; located: number } {
  const totals = new Map<number, number>();
  let located = 0;
  for (let i = lo; i < hi; i++) {
    const d = index.byOffset[i];
    if (!d) continue;
    located++;
    const areasOfDay = d.slice(4) as number[];
    for (const area of areasOfDay) totals.set(area, (totals.get(area) ?? 0) + 1 / areasOfDay.length);
  }
  return { totals, located };
}

export type AreaShare = { area: number; share: number; days: number };

function sortedShares(totals: Map<number, number>, located: number): AreaShare[] {
  return [...totals.entries()]
    .map(([area, days]) => ({ area, days, share: days / located }))
    .sort((a, b) => b.share - a.share || a.area - b.area);
}

/**
 * Every area's share of the located days in the window ending on `date`,
 * largest first — what a trail point's tooltip reports. Walks the window
 * day by day (O(window)), which is fine for the hundred-odd points that
 * have tooltips; the line itself never needs it. Empty for a window with
 * no located days.
 */
export function windowMix(index: DailyIndex | null, date: string, windowDays: number): AreaShare[] {
  if (!index) return [];
  const [lo, hi] = windowBounds(index, daysBetween(index.first, date), windowDays);
  const { totals, located } = windowTotals(index, lo, hi);
  return sortedShares(totals, located);
}

export type WindowDetail = {
  /** First and last calendar day the window covers — shorter than the
   * window setting in the record's first `windowDays` (see windowBounds). */
  from: string;
  to: string;
  /** Calendar days covered, and how many of them are located. */
  spanDays: number;
  locatedDays: number;
  areas: AreaShare[];
  /** The same days rolled up by each area's country, largest first. */
  countries: { name: string; share: number }[];
  /** Areas whose first located day anywhere in the record falls inside
   * this window, in the order they were first visited. */
  firstVisits: { area: number; date: string }[];
};

/**
 * Everything the click-to-open detail panel shows for one trail point
 * (#215). Heavier than windowMix — the first-visit list scans the record
 * from its start up to the window's end — so it's computed for the one
 * point that's open, not for every point up front.
 */
export function windowDetail(
  index: DailyIndex | null,
  areas: CentreArea[],
  date: string,
  windowDays: number,
): WindowDetail | null {
  if (!index) return null;
  const [lo, hi] = windowBounds(index, daysBetween(index.first, date), windowDays);
  const { totals, located } = windowTotals(index, lo, hi);
  if (located === 0) return null;

  const byCountry = new Map<string, number>();
  for (const [area, days] of totals) {
    const name = areas[area].context ?? areas[area].label;
    byCountry.set(name, (byCountry.get(name) ?? 0) + days);
  }

  const firstSeen = new Map<number, number>();
  for (let i = 0; i < hi; i++) {
    const d = index.byOffset[i];
    if (!d) continue;
    for (const area of d.slice(4) as number[]) if (!firstSeen.has(area)) firstSeen.set(area, i);
  }

  return {
    from: addDays(index.first, lo),
    to: addDays(index.first, hi - 1),
    spanDays: hi - lo,
    locatedDays: located,
    areas: sortedShares(totals, located),
    countries: [...byCountry.entries()]
      .map(([name, days]) => ({ name, share: days / located }))
      .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name)),
    firstVisits: [...firstSeen.entries()]
      .filter(([, offset]) => offset >= lo)
      .sort((a, b) => a[1] - b[1])
      .map(([area, offset]) => ({ area, date: addDays(index.first, offset) })),
  };
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
