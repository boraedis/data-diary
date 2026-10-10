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

/** The city the heatmap opens on when the URL names none. */
export const DEFAULT_CITY: CityKey = "dc-metro";

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
 * these regions by matching the municipality its catalog path names, and
 * only failing that by where its coordinates fall
 * (resolveCitySuburbFeature) — the spatial join the US county map uses
 * for the same reason (see us-counties.ts's header). Name first, so a
 * wrong coordinate shows as a misplaced dot instead of quietly moving
 * the place into another polygon.
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
   * read by scripts/geo-fetch-suburbs.mjs to pick the Census places
   * inside it. */
  countyFips: string;
  /** Filename under src/data/geo/sources/, as for CityRootConfig. */
  sourceFile: string;
  /** Set for an independent city drawn as one feature rather than split
   * into Census places — the feature's own `name`. Build tooling only. */
  singleFeatureName?: string;
  /** Census place GEOIDs to leave out of this region. For a place that is
   * already drawn finer elsewhere on the same map — Atlanta, whose own
   * neighborhood layer sits where the Census's Atlanta place would.
   * Build tooling only. */
  excludeGeoids?: string[];
};

export type CityConfig = {
  /** Display label for the city picker. */
  label: string;
  /** Filename under src/data/geo/ — both the topojson object key inside
   * that file and its own filename share this city's Record key, e.g.
   * "dc-metro" -> src/data/geo/dc-metro.topo.json's `objects["dc-metro"]`. */
  sources: CityRootConfig[];
  /** Regions resolved by catalog name, then coordinates, rather than catalog ancestry — see
   * CitySuburbConfig. Checked only for places under none of `sources`'
   * roots, so a catalog-rooted place never changes neighborhood because
   * a suburb was added beside it. */
  suburbs?: CitySuburbConfig[];
  /** Roots (catalog or suburb) the map opens framed on, and returns to on
   * a background click, when that should be less than everything drawn.
   * Omit to frame the whole city. The rest stays drawn and reachable by
   * zooming out, see CityHeatmapExplorer's zoom extent. */
  homeRoots?: string[];
  /** The metro's central city, outlined on the map so it stays findable
   * against the suburbs and neighbours drawn around it. Omit for a city
   * with no surroundings, where an outline would only trace the whole map.
   *
   * Its own boundary, not the neighborhoods dissolved into one: two
   * adjacent neighborhood polygons from a city GIS layer rarely share
   * their edge exactly, so merging them leaves every near-miss as a white
   * line through the middle of the city. The Census place boundary is one
   * clean ring. Fetched by scripts/geo-fetch-suburbs.mjs, and carried in
   * the city's topology as its `outline` object. */
  primary?: {
    /** Display name, for the chart's caption. */
    name: string;
    /** Census place GEOID of the city (7 digits: state + place). Build
     * tooling only. */
    geoid: string;
    /** Filename under src/data/geo/sources/, as for CityRootConfig. */
    sourceFile: string;
  };
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
    // Opens on the city itself; the metro's counties are a zoom-out away,
    // as for DC (see below).
    homeRoots: ["Atlanta"],
    primary: { name: "Atlanta", geoid: "1304000", sourceFile: "atlanta-outline.geojson" },
    // The five core counties, split into Census places the same way as the
    // DC suburbs and for the same reason (the catalog files Brookhaven,
    // Sandy Springs, Hapeville, College Park... straight under Georgia, with
    // no Atlanta ancestor). The Census's own Atlanta place is excluded:
    // the city is drawn from its neighborhood layer instead.
    suburbs: [
      {
        root: "Fulton County",
        stateRootId: 741,
        countyFips: "13121",
        sourceFile: "fulton-county.geojson",
        excludeGeoids: ["1304000"],
      },
      {
        root: "DeKalb County",
        stateRootId: 741,
        countyFips: "13089",
        sourceFile: "dekalb-county.geojson",
        excludeGeoids: ["1304000"],
      },
      { root: "Cobb County", stateRootId: 741, countyFips: "13067", sourceFile: "cobb-county.geojson" },
      { root: "Clayton County", stateRootId: 741, countyFips: "13063", sourceFile: "clayton-county.geojson" },
      { root: "Gwinnett County", stateRootId: 741, countyFips: "13135", sourceFile: "gwinnett-county.geojson" },
    ],
    // The alias table is for the city's own neighborhood layer; the county
    // regions match Census place names exactly, with coordinates as the
    // fallback for a catalog name that isn't a Census place.
    normalize: (root, name) => (root === "Atlanta" ? normalizeAtlantaName(name) : name),
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
    // The suburbs (#281) quadruple the map's extent, which would open DC's
    // neighborhoods — the ones logged most — as specks. So the map opens
    // on DC and Arlington, and the suburbs are a zoom-out away.
    homeRoots: ["Washington", "Arlington"],
    primary: { name: "Washington, DC", geoid: "1150000", sourceFile: "washington-dc-outline.geojson" },
    // #281. Fairfax City and Falls Church are independent cities, not
    // part of Fairfax County, so each is its own region. The counties are
    // split into Census places (towns and CDPs), the grain the catalog
    // logs them at — see scripts/geo-fetch-suburbs.mjs.
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
