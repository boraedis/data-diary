import * as d3 from "d3";
import type { Feature, Geometry } from "geojson";
import type { AdminRegionProperties } from "@/lib/geo/admin-regions";

/**
 * The subdivision a place falls in (#304), by point-in-polygon — the
 * non-US counterpart to us-counties.ts's `resolveCountyForPoint`, and a
 * spatial join for the same underlying reason: see admin-regions.ts on why
 * the catalog's own province-level names can't be trusted to match.
 *
 * `points` is the place's own coordinates followed by each ancestor's,
 * nearest first, stopping short of the country itself. The first one that
 * lands inside a polygon wins. Two real cases need the ancestors:
 *
 *  - **No coordinates of its own.** A handful of places were logged
 *    without an address. Their city or province node usually has one.
 *  - **A point on a lost coastline.** The committed files are simplified
 *    to ~150KB each (see scripts/geo-build-admin.mjs), which shaves
 *    harbours and headlands; a waterfront restaurant can end up a few
 *    hundred metres offshore of the simplified polygon. Its city's own
 *    point, further inland, still lands.
 *
 * What this deliberately doesn't do is snap to the *nearest* polygon when
 * nothing lands — same call us-counties.ts makes: a wrong province is
 * worse than an honest gap, and the caller reports the gap. Walking the
 * catalog's own ancestry is different in kind: it's still the place's own
 * recorded location, just at a coarser grain.
 */
export function resolveAdminRegion(
  features: readonly Feature<Geometry, AdminRegionProperties>[],
  points: readonly (readonly [lng: number, lat: number])[],
): string | null {
  for (const point of points) {
    for (const region of features) {
      if (d3.geoContains(region, point as [number, number])) return region.properties.name;
    }
  }
  return null;
}
