import { normalizeAtlantaName } from "./atlanta-names";
import { normalizeDcMetroName } from "./dc-metro-names";
import { normalizeDubaiName } from "./dubai-names";
import { normalizeNycName } from "./nyc-names";
import { normalizeIstanbulName } from "./istanbul-names";

// Single source of truth for #177's 5 city-heatmap cities — shared by
// scripts/geo-build.mjs and scripts/geo-add-feature.mjs (imported via
// tsx, which runs .ts files directly, same as this app) and by
// src/lib/charts.ts's getCityHeatmapData. Previously this lived twice —
// a plain-JS copy under scripts/lib/ for the build tooling and an
// implicit, never-written second copy this app would have needed for
// #266 — collapsed into one file per #266's own note not to duplicate
// city/root config any more than the resolution logic itself.
export type CityKey = "atlanta" | "dc-metro" | "dubai" | "nyc" | "istanbul";

export type CityRootConfig = {
  /** Catalog root name — places.namePath's segment at `rootId`. */
  root: string;
  /** This root's real places.id in the current database — see
   * city-config's own git history / #265 for why name-matching alone
   * isn't reliable (a root's name can recur elsewhere in its own path,
   * e.g. Dubai the emirate containing Dubai the city). Stable for the
   * life of this one database; re-verify if the catalog is ever fully
   * reseeded. */
  rootId: number;
  /** Filename under src/data/geo/sources/ — build-tooling only, unused
   * by the app (which reads the committed .topo.json instead). */
  sourceFile: string;
};

/**
 * A region drawn on a city's map that has no catalog node of its own to
 * root it (#281's DC suburbs). The catalog files these places straight
 * under their state — USA/Virginia/Reston/..., USA/Maryland/Bethesda/... —
 * alongside Richmond and Ocean City, so there's no subtree to walk the way
 * CityRootConfig's roots are walked. Instead a place resolves to one of
 * these regions by where its coordinates fall (resolveCitySuburbFeature),
 * the same spatial join the US county map uses for the same reason (see
 * us-counties.ts's header).
 */
export type CitySuburbConfig = {
  /** The geometry features' `root` property, and this region's display
   * name. Not a catalog name — nothing in places.namePath matches it. */
  root: string;
  /** places.id of the state the catalog files this region's places
   * under. A point only resolves to this region when the place's idPath
   * passes through it, so a mis-geocoded place from another state (an
   * Illinois "Springfield" landing in Springfield, VA) can't be pulled
   * onto the map by its coordinates alone. Same stability caveat as
   * CityRootConfig.rootId. */
  stateRootId: number;
  /** 5-digit county FIPS (or independent city's) — build tooling only,
   * read by scripts/geo-fetch-dc-suburbs.mjs to pick the Census places
   * inside it. */
  countyFips: string;
  /** Filename under src/data/geo/sources/, as for CityRootConfig. */
  sourceFile: string;
  /** Set for an independent city drawn as one feature rather than split
   * into Census places — the feature's own `name`. Build tooling only. */
  singleFeatureName?: string;
};

export type CityConfig = {
  /** Display label for the city picker. */
  label: string;
  /** Filename under src/data/geo/ — both the topojson object key inside
   * that file and its own filename share this city's Record key, e.g.
   * "dc-metro" -> src/data/geo/dc-metro.topo.json's `objects["dc-metro"]`. */
  sources: CityRootConfig[];
  /** Regions resolved by coordinates rather than catalog ancestry — see
   * CitySuburbConfig. Checked only for places under none of `sources`'
   * roots, so a catalog-rooted place never changes neighborhood because
   * a suburb was added beside it. */
  suburbs?: CitySuburbConfig[];
  /** Normalizes a catalog neighborhood name to this city's geometry
   * naming — see each root's own normalize<City>Name for the real,
   * documented aliases/gaps. Takes `root` even for single-root cities so
   * every city shares one call signature. */
  normalize: (root: string, name: string) => string;
};

export const CITIES: Record<CityKey, CityConfig> = {
  atlanta: {
    label: "Atlanta",
    sources: [{ root: "Atlanta", rootId: 701, sourceFile: "atlanta.geojson" }],
    normalize: (_root, name) => normalizeAtlantaName(name),
  },
  "dc-metro": {
    label: "DC Metro",
    // Not one subtree: Arlington and Alexandria are their own catalog
    // roots (USA/Virginia/Arlington, USA/Virginia/Alexandria), not
    // descendants of the Washington place node — see #265's issue body
    // for how this was confirmed against the real catalog.
    sources: [
      { root: "Washington", rootId: 1566, sourceFile: "washington-dc.geojson" },
      { root: "Arlington", rootId: 83, sourceFile: "arlington.geojson" },
      { root: "Alexandria", rootId: 2000, sourceFile: "alexandria.geojson" },
    ],
    // #281. Fairfax City and Falls Church are independent cities, not
    // part of Fairfax County, so each is its own region. The counties are
    // split into Census places (towns and CDPs), the grain the catalog
    // logs them at — see scripts/geo-fetch-dc-suburbs.mjs.
    suburbs: [
      { root: "Fairfax County", stateRootId: 1828, countyFips: "51059", sourceFile: "fairfax-county.geojson" },
      {
        root: "Fairfax City",
        stateRootId: 1828,
        countyFips: "51600",
        sourceFile: "fairfax-city.geojson",
        singleFeatureName: "City of Fairfax",
      },
      {
        root: "Falls Church",
        stateRootId: 1828,
        countyFips: "51610",
        sourceFile: "falls-church.geojson",
        singleFeatureName: "City of Falls Church",
      },
      { root: "Montgomery County", stateRootId: 1392, countyFips: "24031", sourceFile: "montgomery-county.geojson" },
      {
        root: "Prince George's County",
        stateRootId: 1392,
        countyFips: "24033",
        sourceFile: "prince-georges-county.geojson",
      },
    ],
    // Cast, not a widened DcMetroRoot signature on normalizeDcMetroName
    // itself — every caller of *this* config only ever passes a `root`
    // string that came from `sources[].root` or `suburbs[].root` above,
    // which is always one of the real DcMetroRoot values; the wider
    // `string` type here exists only so every city can share one
    // CityConfig["normalize"] shape.
    normalize: normalizeDcMetroName as (root: string, name: string) => string,
  },
  dubai: {
    label: "Dubai",
    sources: [{ root: "Dubai", rootId: 554, sourceFile: "dubai.geojson" }],
    normalize: (_root, name) => normalizeDubaiName(name),
  },
  nyc: {
    label: "New York City",
    sources: [{ root: "New York City", rootId: 928, sourceFile: "nyc.geojson" }],
    normalize: (_root, name) => normalizeNycName(name),
  },
  istanbul: {
    label: "Istanbul",
    sources: [{ root: "Istanbul", rootId: 1607, sourceFile: "istanbul.geojson" }],
    normalize: (_root, name) => normalizeIstanbulName(name),
  },
};
