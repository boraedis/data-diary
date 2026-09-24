// Which countries on the world map break into their own subdivisions when
// clicked (#304), and at which administrative level.
//
// The US isn't here: it has its own, older path through us-atlas (see
// us-geo-levels.ts), with states resolved by name and counties by a
// separate spatial join. Everything in this file is the non-US half.
//
// Read by three things, which is why it imports nothing — no JSON, no `@/`
// alias — so a plain `tsx` script can load it the same way geo-build.mjs
// loads city-config.ts:
//
//  - scripts/geo-build-admin.mjs, which downloads each entry's geometry
//    from geoBoundaries and writes src/data/geo/admin/<iso3>.topo.json
//  - src/lib/geo/admin-lookup.ts, the server-side point-in-polygon join
//  - src/components/charts/world-visits-chart.tsx, via admin-geometry.ts's
//    lazy loaders
//
// **Why every country comes from geoBoundaries.** Legacy's
// public/assets/worldBorders mixed three sources, and the `*_adm.json`
// files among them (Canada, Germany, Spain, the Netherlands, Iceland,
// Japan, Tanzania) are GADM, whose licence forbids redistribution. That's
// a real problem for files committed to a repo that also serves a public
// site. geoBoundaries' gbOpen release is openly licensed per country
// (CC BY, CC0, ODbL, OGL, Etalab — attribution recorded per file in
// src/data/geo/admin/SOURCES.json by the build script), and one source
// means one property schema (`shapeName`) instead of a per-country
// accessor for each file's own naming, which is what legacy's
// `state_maps` table was mostly made of.
//
// **Why the join is spatial rather than by name.** Measured against the
// real catalog before building (#304's first acceptance criterion): every
// country with logged days has a province-level node under it, but the
// names at that level don't reliably mean the level they claim. Cuba's
// has a national park as a "province", Greece's has islands where its
// regions should be, Czechia's mixes "Prague" with "Central Bohemian
// Region", and there are typos ("Sancti Spirutus", "Siene-Saint-Denis").
// Name matching would need an alias table per country for every one of
// those, forever. Coordinates need none: geocoding coverage is near-total
// (the same reason us-counties.ts's county join works), so which polygon a
// place falls in is a fact about the map, not about how it was typed.

export type AdminLevel = "ADM1" | "ADM2";

export type AdminRegionConfig = {
  /** ISO 3166-1 alpha-3 — what geoBoundaries keys its files by, and the
   * committed file's basename (lowercased). */
  iso3: string;
  /** Which geoBoundaries level to draw. ADM1 unless the catalog is
   * genuinely organised one level down; see `levelNote` where it isn't. */
  level: AdminLevel;
  /** What one subdivision is called — for the tooltip and the aria label,
   * e.g. "Izmir" is one of Turkey's provinces. Plural. */
  unitLabel: string;
  /** Why this entry isn't plain gbOpen ADM1, when it isn't. */
  levelNote?: string;
  /** geoBoundaries release to pull from. gbOpen unless a country's gbOpen
   * layer is wrong in a way that matters; gbHumanitarian (OCHA/HDX's
   * common operational datasets) is the fallback, still openly licensed. */
  release?: "gbOpen" | "gbHumanitarian";
  /** Applied by the build before anything else reads a name, so the
   * committed file, the join key and the tooltip all agree. Only for names
   * that read as wrong rather than merely local — "Bayern" and "Wien" are
   * the real names and stay; Greece's romanised genitives don't. */
  rename?: Record<string, string>;
  /** A suffix geoBoundaries applies to some of a layer's names but not
   * others, stripped so the set reads consistently. */
  dropSuffix?: string;
};

/**
 * Keyed by world-atlas's own feature id (ISO 3166-1 numeric, as a
 * zero-padded string) — the key the world map already has in hand for a
 * clicked country, and what `unlogged_travel.code` stores for one (see
 * country-lookup.ts), so there's one country key across the page rather
 * than a name that has to go through `normalizeCountryName` first.
 *
 * The list is every country with logged days when #304 shipped, not every
 * country geoBoundaries covers. Geometry with nothing to colour would
 * expand into a map of empty polygons, which is worse than the
 * zoom-to-bounds a country without an entry here still gets. The build
 * script's catalog check lists any country that has logged days but no
 * entry, so a new trip shows up as a one-line addition here rather than as
 * silence.
 */
export const ADMIN_REGIONS: Record<string, AdminRegionConfig> = {
  "784": { iso3: "ARE", level: "ADM1", unitLabel: "emirates" },
  "792": { iso3: "TUR", level: "ADM1", unitLabel: "provinces" },
  "124": { iso3: "CAN", level: "ADM1", unitLabel: "provinces and territories" },
  // About half of JPN's shapeNames carry " Prefecture" ("Kyoto
  // Prefecture", "Tokyo") — dropped so the tooltip doesn't look like two
  // different kinds of place.
  "392": { iso3: "JPN", level: "ADM1", unitLabel: "prefectures", dropSuffix: " Prefecture" },
  "528": { iso3: "NLD", level: "ADM1", unitLabel: "provinces" },
  "834": { iso3: "TZA", level: "ADM1", unitLabel: "regions" },
  "360": { iso3: "IDN", level: "ADM1", unitLabel: "provinces" },
  "192": { iso3: "CUB", level: "ADM1", unitLabel: "provinces" },
  "504": { iso3: "MAR", level: "ADM1", unitLabel: "regions" },
  "826": {
    iso3: "GBR",
    level: "ADM2",
    unitLabel: "counties and unitary authorities",
    levelNote:
      "GBR's ADM1 is the four nations. The catalog files England by county and Scotland by council area, which is ADM2's level.",
  },
  "300": {
    iso3: "GRC",
    level: "ADM2",
    unitLabel: "regions",
    levelNote:
      "GRC's ADM1 is the 7 decentralised administrations, coarser than anything the catalog uses. ADM2 is the 13 regions; the catalog's regional units (Rhodes, Kos) have no geoBoundaries layer of their own and land in the South Aegean.",
    // EuroGeoGraphics ships these as romanised Greek genitives ("Notioy
    // Aigaioy" is "of the South Aegean"), one of them truncated.
    rename: {
      "Anatolikis Makedonias kai Thr*": "Eastern Macedonia and Thrace",
      "Kentrikis Makedonias": "Central Macedonia",
      "Dytikis Makedonias": "Western Macedonia",
      Ipeiroy: "Epirus",
      Thessalias: "Thessaly",
      "Stereas Elladas": "Central Greece",
      "Ionion Nison": "Ionian Islands",
      "Dytikis Elladas": "Western Greece",
      Peloponnisoy: "Peloponnese",
      Attikis: "Attica",
      "Voreioy Aigaioy": "North Aegean",
      "Notioy Aigaioy": "South Aegean",
      Kritis: "Crete",
      "Agion Oros": "Mount Athos",
    },
  },
  "250": {
    iso3: "FRA",
    level: "ADM2",
    unitLabel: "departments",
    levelNote: "The catalog files France by department (ADM2), as legacy's map did, not by region (ADM1).",
  },
  "380": {
    iso3: "ITA",
    level: "ADM2",
    unitLabel: "regions",
    levelNote: "ITA's ADM1 is the 5 statistical macro-regions (NUTS 1). The 20 regions the catalog uses are ADM2.",
  },
  "604": { iso3: "PER", level: "ADM1", unitLabel: "regions" },
  "348": {
    iso3: "HUN",
    level: "ADM1",
    unitLabel: "counties",
    release: "gbHumanitarian",
    levelNote:
      "gbOpen's HUN ADM1 has no Budapest: Pest county is drawn as one solid polygon over it, so Budapest days would land in Pest. gbHumanitarian's has Budapest as its own unit (names without diacritics).",
  },
  "276": { iso3: "DEU", level: "ADM1", unitLabel: "states" },
  "203": { iso3: "CZE", level: "ADM1", unitLabel: "regions" },
  "724": { iso3: "ESP", level: "ADM1", unitLabel: "autonomous communities" },
  "372": {
    iso3: "IRL",
    level: "ADM1",
    unitLabel: "provinces",
    levelNote:
      "The catalog files Ireland by county, but geoBoundaries has no county layer for it — ADM1 is the 4 provinces and ADM2 is 166 electoral areas. Provinces are the honest coarser choice.",
  },
  "040": { iso3: "AUT", level: "ADM1", unitLabel: "states" },
  "044": { iso3: "BHS", level: "ADM1", unitLabel: "districts" },
  "705": {
    iso3: "SVN",
    level: "ADM2",
    unitLabel: "municipalities",
    levelNote:
      "SVN's ADM1 is 2 macroregions. The catalog declares Slovenia's children as municipalities, which is ADM2.",
  },
  "616": { iso3: "POL", level: "ADM1", unitLabel: "voivodeships" },
  "352": { iso3: "ISL", level: "ADM1", unitLabel: "regions" },
  "191": { iso3: "HRV", level: "ADM1", unitLabel: "counties" },
  "703": { iso3: "SVK", level: "ADM1", unitLabel: "regions" },
};

/** The TopoJSON object name every committed admin file uses — one name for
 * all of them, so loaders don't need a per-country accessor. */
export const ADMIN_TOPOLOGY_OBJECT = "regions";

/** What each subdivision feature carries after the build strips
 * geoBoundaries' own properties down to what's used. `name` is
 * geoBoundaries' `shapeName` after the config's `rename`/`dropSuffix` —
 * it's also the feature's id and the join key. Unique within a country:
 * the build merges same-named features into one MultiPolygon rather than
 * letting two polygons share one value. */
export type AdminRegionProperties = { name: string };
