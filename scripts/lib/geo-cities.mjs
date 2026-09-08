// Per-city config for scripts/geo-build.mjs and scripts/geo-add-feature.mjs
// — the single place that knows which source file(s) make up which
// committed city-heatmap geometry (#265). Adding a 6th city later means
// adding one entry here, not touching either script's own logic.
//
// `root` is the place-catalog root name (places.namePath's first segment
// for that city) each source maps to — DC-metro is 3 roots because
// Washington/Arlington/Alexandria are 3 independent catalog subtrees
// (see dc-metro's own comment below), every other city is 1.
//
// `rootId` is that root place's real `places.id` in the current
// database (checked 2026-09-08) — geo-build.mjs's catalog-coverage check
// needs the actual row, not just a name match, because a root's own name
// can legitimately recur elsewhere in its own idPath/namePath (Dubai's
// namePath is "UAE/Dubai/Dubai/" — the emirate and the city share a
// name), which makes a plain string search over path segments pick the
// wrong occurrence. A places.id is stable for the life of this one
// database, but wouldn't survive a full catalog reseed/restore — if
// geo-build.mjs ever reports "no catalog place found" for a root that
// should exist, re-check this value against the current database before
// assuming the geometry itself is the problem.
export const CITIES = {
  atlanta: {
    outFile: "atlanta.topo.json",
    sources: [{ file: "atlanta.geojson", root: "Atlanta", rootId: 701 }],
  },
  "dc-metro": {
    outFile: "dc-metro.topo.json",
    // Not one subtree: Arlington and Alexandria are their own catalog
    // roots (USA/Virginia/Arlington, USA/Virginia/Alexandria), not
    // descendants of the Washington place node — see #265's own issue
    // body for how this was confirmed against the real catalog. Each
    // feature in the combined output keeps its source's root so a
    // consumer (#266) can resolve a place to the right one.
    sources: [
      { file: "washington-dc.geojson", root: "Washington", rootId: 1566 },
      { file: "arlington.geojson", root: "Arlington", rootId: 83 },
      { file: "alexandria.geojson", root: "Alexandria", rootId: 2000 },
    ],
  },
  dubai: {
    outFile: "dubai.topo.json",
    sources: [{ file: "dubai.geojson", root: "Dubai", rootId: 554 }],
  },
  nyc: {
    outFile: "nyc.topo.json",
    sources: [{ file: "nyc.geojson", root: "New York City", rootId: 928 }],
  },
  istanbul: {
    outFile: "istanbul.topo.json",
    sources: [{ file: "istanbul.geojson", root: "Istanbul", rootId: 1607 }],
  },
};
