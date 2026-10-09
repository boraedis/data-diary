// Spherical geometry for "where was my life centred" (#215). Pure, no d3 —
// the same boundary as stats.ts and bin.ts: maths over points a caller
// already has.
//
// Nothing here ever averages raw degrees. Longitude wraps at ±180° and a
// degree of longitude shrinks towards the poles, so a mean of lat/lng pairs
// is wrong near the antimeridian and at high latitudes (a Tokyo/Honolulu
// average lands in the Atlantic, on the far side of the planet). Every
// point is converted to a 3D unit vector first, where plain vector sums
// are correct everywhere, and converted back only at the end.

/** [longitude, latitude] in degrees — the order GeoJSON and d3-geo use. */
export type LngLat = [number, number];

export type WeightedPoint = { position: LngLat; weight: number };

type Vec3 = [number, number, number];

/** Mean Earth radius (IUGG), km. */
const EARTH_RADIUS_KM = 6371.0088;

const RAD = Math.PI / 180;

export function toUnitVector([lng, lat]: LngLat): Vec3 {
  const phi = lat * RAD;
  const lambda = lng * RAD;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

/** Direction of `v` as [lng, lat], or null for (near) the zero vector,
 * which has no direction to report. */
export function fromUnitVector([x, y, z]: Vec3): LngLat | null {
  const norm = Math.hypot(x, y, z);
  if (norm < 1e-12) return null;
  return [Math.atan2(y, x) / RAD, Math.asin(Math.max(-1, Math.min(1, z / norm))) / RAD];
}

/** Great-circle distance in km. atan2 of |a×b| and a·b rather than acos of
 * the dot product: acos loses most of its precision for nearby points,
 * which is exactly the range (a few km within one city) this gets asked
 * about most. */
export function greatCircleKm(a: LngLat, b: LngLat): number {
  const [ax, ay, az] = toUnitVector(a);
  const [bx, by, bz] = toUnitVector(b);
  const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  const dot = ax * bx + ay * by + az * bz;
  return Math.atan2(cross, dot) * EARTH_RADIUS_KM;
}

// ~6 cm on the Earth's surface. Far below anything a place's geocode can
// resolve, so iterating past it only burns time.
const CONVERGENCE = 1e-8;
const MAX_ITERATIONS = 500;

/**
 * The weighted geometric median of points on the sphere: the point that
 * minimises the weighted sum of distances to every input, found with
 * Weiszfeld's algorithm on the points' 3D unit vectors.
 *
 * **Why the median and not a mean.** A mean minimises *squared* distance,
 * so a far-away minority pulls it in proportion to how far away it is —
 * one fortnight abroad drags a year's mean hundreds of kilometres off
 * home. The median minimises plain distance: every day pulls with the same
 * strength whatever its distance. The property that matters most for
 * #215 follows from that: **if one point carries at least half the total
 * weight, the median is exactly that point.** A year with most of its days
 * in one place is centred *on* that place, not somewhere between it and
 * the rest; the median only leaves the places actually visited when no
 * single area holds a majority.
 *
 * **Chord, not arc.** The iteration minimises straight-line (chord)
 * distance through the Earth between unit vectors, then projects the
 * answer back onto the surface. Chord length is a monotonic function of
 * arc length, so for points within a hemisphere — everything this app has
 * logged — the two medians agree to well within a place's own geocoding
 * error, and the chord version is a simple, fast, convergent iteration.
 *
 * **Coincident points.** Plain Weiszfeld divides by the distance to each
 * input and breaks down when the estimate lands exactly on one, which is
 * the *common* case here (the majority property above). This uses the
 * Vardi–Zhang modification, which handles that case exactly: it stops on
 * an input point when that point's own weight outweighs the pull of all
 * the others.
 *
 * Returns null for no points, zero total weight, or the degenerate case
 * where the inputs cancel out (weights balanced on opposite sides of the
 * planet), which has no meaningful centre to report.
 */
export function sphericalGeometricMedian(points: WeightedPoint[]): LngLat | null {
  const pts = points
    .filter((p) => p.weight > 0 && Number.isFinite(p.position[0]) && Number.isFinite(p.position[1]))
    .map((p) => ({ v: toUnitVector(p.position), w: p.weight }));
  if (pts.length === 0) return null;
  if (pts.length === 1) return fromUnitVector(pts[0].v);

  // Start from the weighted mean direction: cheap, and already inside the
  // convex hull the median lives in. If the inputs cancel to (near) zero,
  // start from the heaviest point instead.
  let x: Vec3 = [0, 0, 0];
  let totalWeight = 0;
  for (const { v, w } of pts) {
    x = [x[0] + v[0] * w, x[1] + v[1] * w, x[2] + v[2] * w];
    totalWeight += w;
  }
  x = [x[0] / totalWeight, x[1] / totalWeight, x[2] / totalWeight];
  if (Math.hypot(...x) < 1e-9) {
    x = pts.reduce((best, p) => (p.w > best.w ? p : best)).v;
  }

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // T: the ordinary Weiszfeld step over every point the estimate isn't
    // sitting on. R: the net "pull" of those same points. eta: the weight
    // of a point the estimate *is* sitting on, if any.
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let rx = 0;
    let ry = 0;
    let rz = 0;
    let denom = 0;
    let eta = 0;
    for (const { v, w } of pts) {
      const dx = v[0] - x[0];
      const dy = v[1] - x[1];
      const dz = v[2] - x[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-12) {
        eta += w;
        continue;
      }
      const s = w / d;
      tx += v[0] * s;
      ty += v[1] * s;
      tz += v[2] * s;
      rx += dx * s;
      ry += dy * s;
      rz += dz * s;
      denom += s;
    }
    if (denom === 0) break; // every point coincides with the estimate
    const T: Vec3 = [tx / denom, ty / denom, tz / denom];
    const r = Math.hypot(rx, ry, rz);

    let next: Vec3;
    if (eta === 0) {
      next = T;
    } else if (r <= eta) {
      // Sitting on a point whose own weight beats everyone else's pull:
      // that point *is* the median.
      break;
    } else {
      const k = eta / r;
      next = [(1 - k) * T[0] + k * x[0], (1 - k) * T[1] + k * x[1], (1 - k) * T[2] + k * x[2]];
    }

    const step = Math.hypot(next[0] - x[0], next[1] - x[1], next[2] - x[2]);
    x = next;
    if (step < CONVERGENCE) break;
  }

  return fromUnitVector(x);
}

/** The weighted median of `values`: the value where the cumulative weight,
 * sorted ascending, first reaches half the total. When it lands exactly on
 * half (an even count of equal weights), the midpoint of the two values
 * either side, the usual median. Null for nothing with positive weight. */
export function weightedMedian(values: readonly { value: number; weight: number }[]): number | null {
  const sorted = values.filter((v) => v.weight > 0 && Number.isFinite(v.value)).sort((a, b) => a.value - b.value);
  if (sorted.length === 0) return null;
  const half = sorted.reduce((sum, v) => sum + v.weight, 0) / 2;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i].weight;
    if (Math.abs(cumulative - half) < 1e-9 && i + 1 < sorted.length) {
      return (sorted[i].value + sorted[i + 1].value) / 2;
    }
    if (cumulative > half) return sorted[i].value;
  }
  return sorted[sorted.length - 1].value;
}

/**
 * The Economist's "centre of gravity" (#512): the point with as many days
 * to its north as its south and to its east as its west, i.e. the weighted
 * median latitude and, separately, the weighted median longitude.
 *
 * Simpler to say than the geometric median above ("half my days were north
 * of this line") and what the chart that inspired #215 used. Unlike it,
 * it isn't rotation-invariant, and the two medians are taken independently,
 * so the result can land where no day was: half the days north of a line
 * and half east of another doesn't put anyone at the crossing.
 *
 * **Longitude is taken in a rotated frame.** Raw longitudes break at ±180°:
 * days either side of the date line sort to opposite ends and the median
 * lands on the far side of the planet. So every longitude is first measured
 * from the points' weighted mean direction (wrapped into ±180° of it), the
 * median taken there, and the result rotated back. That's correct for any
 * set of points within a hemisphere of their mean, which is everything this
 * app logs. Latitude has no wrap and is taken as-is.
 */
export function coordinateWiseMedian(points: WeightedPoint[]): LngLat | null {
  const pts = points.filter(
    (p) => p.weight > 0 && Number.isFinite(p.position[0]) && Number.isFinite(p.position[1]),
  );
  if (pts.length === 0) return null;

  let sum: Vec3 = [0, 0, 0];
  for (const { position, weight } of pts) {
    const v = toUnitVector(position);
    sum = [sum[0] + v[0] * weight, sum[1] + v[1] * weight, sum[2] + v[2] * weight];
  }
  // Inputs that cancel out have no mean direction; any frame is as good as
  // another then, and 0° is the plain one.
  const origin = fromUnitVector(sum)?.[0] ?? 0;
  const wrap = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

  const lat = weightedMedian(pts.map((p) => ({ value: p.position[1], weight: p.weight })));
  const relLng = weightedMedian(pts.map((p) => ({ value: wrap(p.position[0] - origin), weight: p.weight })));
  if (lat === null || relLng === null) return null;
  return [wrap(relLng + origin), lat];
}
