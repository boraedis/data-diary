// Shared by geo-build.mjs and geo-add-feature.mjs — normalizes ring
// winding so every polygon renders correctly through this app's actual
// toolchain (topojson-server -> topojson-client -> d3.geoPath).
//
// That toolchain does NOT use GeoJSON's own RFC 7946 winding convention
// (exterior rings counterclockwise) — it follows d3-geo/topojson's own
// spherical convention instead, which topojson-simplify's own README
// states outright is "the opposite of RFC 7946": exterior rings
// clockwise, holes counterclockwise, in [lon, lat]-plane shoelace sign.
// (Getting this backwards — assuming RFC 7946 instead — silently
// corrupts every polygon into filling its entire projected viewport, not
// a visibly-broken shape. A Polygon with reversed-but-still-valid rings
// is still perfectly valid GeoJSON, so neither tsc nor eslint catches
// this class of bug — only actually rendering the output does.)
//
// None of #265's 5 real sources actually needed this fix (they're all
// already CW-exterior, being originally sourced from ESRI shapefiles or
// OSM data that both already follow this same convention) — it exists
// so a future hand-drawn or differently-sourced feature (e.g. via
// geojson.io, which follows RFC 7946 and would export CCW-exterior)
// gets silently corrected instead of silently breaking the same way this
// file almost did.

function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum;
}

function fixRingWinding(rings) {
  return rings.map((ring, i) => {
    const ccw = signedArea(ring) > 0;
    const shouldBeCw = i === 0; // ring 0 = exterior, rest = holes
    return ccw === !shouldBeCw ? ring : [...ring].reverse();
  });
}

export function fixWinding(geometry) {
  if (geometry.type === "Polygon") {
    return { ...geometry, coordinates: fixRingWinding(geometry.coordinates) };
  }
  if (geometry.type === "MultiPolygon") {
    return { ...geometry, coordinates: geometry.coordinates.map(fixRingWinding) };
  }
  return geometry;
}
