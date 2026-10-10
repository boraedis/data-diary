/**
 * Fetches a metro heatmap's suburban regions from the Census Bureau's
 * TIGERweb service and writes them as editable sources under
 * src/data/geo/sources/ — DC metro's five (#281: fairfax-county,
 * fairfax-city, falls-church, montgomery-county, prince-georges-county)
 * and Atlanta's five counties. Run `npm run geo:build <city>` afterwards
 * to fold them into the committed <city>.topo.json, same as any hand edit
 * under sources/.
 *
 * Every city whose config has `suburbs` is a candidate; name cities on the
 * command line to fetch just those. The rest of this comment was written
 * for DC and holds for every metro.
 *
 * ## Why Census places, for all five
 *
 * #281 expected Fairfax to come from the county's own GIS portal and
 * Maryland to need something coarser, since Montgomery and Prince George's
 * publish no neighborhood layer. One source turned out to cover all of
 * them at the same grain: the Census's *places* — incorporated cities and
 * towns plus Census Designated Places (CDPs), the statistical stand-ins
 * the Bureau draws for unincorporated communities. The catalog's own
 * suburban entries are already exactly this grain (Reston, Tysons,
 * Chantilly, Bailey's Crossroads, Wolf Trap, Bethesda, Silver Spring,
 * College Park, Landover are all Census places), so a place layer matches
 * how things are actually logged, where a finer neighborhood layer would
 * leave most of them with nothing to name.
 *
 * Fairfax City and Falls Church are independent cities (not part of
 * Fairfax County), so each is its own single-feature region: the Census
 * place with the same boundary as the city.
 *
 * ## Which places belong to which county
 *
 * Places aren't keyed by county, so membership is the place's own
 * internal point (INTPTLAT/INTPTLON, which the Census guarantees falls
 * inside the place) tested against the county polygon. No clipping: in
 * these three counties every CDP sits inside one county, and the handful
 * of incorporated places that touch a county line (Laurel, for one) are
 * credited to the county holding their internal point. That is a few
 * slivers of overlap at the edge of the map, not double-counting, since a
 * logged point still lands in exactly one feature (the first containing
 * it, see resolveCitySuburbFeature).
 *
 * Places don't tile a county. What's left over is parkland and
 * low-density unincorporated land with no CDP: about a tenth of Fairfax
 * and Prince George's, and over a third of Montgomery, whose upcounty
 * agricultural reserve has almost none. Each county therefore also gets
 * one "Rest of <county>" feature, which is simply the whole county
 * polygon, flagged `remainder: true` and written *first* in the file:
 * drawn first, it sits underneath the places and shows only in the gaps
 * between them, and resolveCitySuburbFeature checks it only after every
 * place has missed. Overlap-and-order rather than a real polygon
 * difference because this repo has no polygon-clipping dependency, and
 * the result is the same on screen. Without it, a day spent in Poolesville
 * would fall off the map entirely, not even as a dot.
 *
 * ## Vintage
 *
 * The Census 2020 layers (25/26 for places, 55 for counties), not the
 * newest ACS ones: decennial boundaries are fixed, so a rerun reproduces
 * the committed files rather than silently picking up a redrawn CDP.
 * Census data is public domain; no attribution is required, though the
 * chart's methodology text names it anyway.
 *
 * ## The primary city's outline
 *
 * The same run fetches the central city's own Census place (`primary` in
 * the city config) and writes it as a single-feature source, which
 * geo-build carries into the topology as its `outline` object. It is only
 * ever drawn as a line; see CityConfig.primary for why that isn't just the
 * neighborhoods dissolved.
 *
 * ## The primary city is left out
 *
 * A region's `excludeGeoids` drops Census places from it. Atlanta uses
 * this for the Census's own "Atlanta" place, which spans Fulton and DeKalb:
 * the city is already drawn, finer, from its neighborhood layer, and a
 * second Atlanta-shaped polygon beneath it would only be a rival
 * definition of the same ground.
 *
 * Usage:
 *   npm run geo:fetch-suburbs            # every city with suburbs
 *   npm run geo:fetch-suburbs atlanta    # just one
 *
 * Network only, no database.
 *
 * ## Simplification happens here, not on the server or in geo:build
 *
 * TIGERweb can generalize geometry itself (maxAllowableOffset), but it
 * does so one feature at a time, so two CDPs sharing a street come back
 * with two slightly different versions of it — a sliver between them on
 * the map. Instead everything is fetched at full resolution and
 * simplified here as one topology (topojson-simplify), which simplifies
 * each shared edge once for both sides. geo:build's own simplify pass is
 * a near no-op by design (see its comment) and stays that way for the
 * hand-maintained neighborhood sources; these sources are written
 * already simplified so the committed TopoJSON doesn't more than double
 * the dc-metro file for regions that are context around DC rather than
 * the point of the map.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as d3 from "d3";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import { feature } from "topojson-client";
import { fixWinding } from "./lib/geo-winding.mjs";
import { CITIES } from "../src/lib/geo/city-config.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_DIR = path.join(__dirname, "..", "src", "data", "geo", "sources");

const TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
const COUNTIES_LAYER = `${TIGERWEB}/State_County/MapServer/55`; // Census 2020 Counties
const PLACE_LAYERS = [
  `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/25`, // Census 2020 Incorporated Places
  `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/26`, // Census 2020 Census Designated Places
];
// Minimum triangle area (in square degrees — presimplify's planar default
// over raw lon/lat) a vertex must carry to survive; roughly a triangle
// 80m on a side. Picked by size (measured 2026-10-09): it takes the
// committed dc-metro.topo.json from 164KB to 287KB (55KB -> 93KB
// gzipped), about the size of nyc.topo.json, where 1e-8 more than
// tripled it. 1e-6 saves only another 30KB and starts cutting corners
// off the smaller towns.
const SIMPLIFY_WEIGHT = 3e-7;

async function query(layerUrl, where, envelope) {
  const params = new URLSearchParams({
    where,
    outFields: "GEOID,BASENAME,NAME,LSADC,INTPTLAT,INTPTLON",
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "6",
    f: "geojson",
  });
  if (envelope) {
    // Only places near the counties — a full-resolution fetch of every
    // place in two states would hit the service's transfer limit.
    const [[w, s], [e, n]] = envelope;
    params.set("geometry", [w, s, e, n].join(","));
    params.set("geometryType", "esriGeometryEnvelope");
    params.set("inSR", "4326");
    params.set("spatialRel", "esriSpatialRelIntersects");
  }
  const res = await fetch(`${layerUrl}/query?${params}`);
  if (!res.ok) throw new Error(`${layerUrl}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`${layerUrl}: ${JSON.stringify(json.error)}`);
  if (json.exceededTransferLimit) throw new Error(`${layerUrl}: result truncated, page the query`);
  return json.features.map((f) => ({ ...f, geometry: fixWinding(f.geometry) }));
}

function toSourceFeature(f, name) {
  // Only what the chart and the build need. GEOID is kept so a future
  // rerun or a hand edit can be traced back to its Census record.
  return { type: "Feature", properties: { name, geoid: f.properties.GEOID }, geometry: f.geometry };
}

async function fetchCity(cityKey) {
  const regions = CITIES[cityKey].suburbs ?? [];
  const states = [...new Set(regions.map((r) => r.countyFips.slice(0, 2)))];
  console.log(`${cityKey}:`);

  const counties = new Map();
  for (const f of await query(COUNTIES_LAYER, `GEOID IN (${regions.map((r) => `'${r.countyFips}'`).join(",")})`)) {
    counties.set(f.properties.GEOID, f);
  }
  const envelope = d3.geoBounds({ type: "FeatureCollection", features: [...counties.values()] });
  const places = [];
  for (const layer of PLACE_LAYERS) {
    places.push(...(await query(layer, `STATE IN (${states.map((s) => `'${s}'`).join(",")})`, envelope)));
  }

  // Every region's features, tagged with which region they're for, so
  // they can be simplified together and split apart again afterwards.
  const tagged = [];
  for (const [regionIndex, region] of regions.entries()) {
    const county = counties.get(region.countyFips);
    if (!county) throw new Error(`county ${region.countyFips} (${region.root}) not returned by TIGERweb`);
    const members = places.filter(
      (p) =>
        p.properties.GEOID.startsWith(region.countyFips.slice(0, 2)) &&
        !(region.excludeGeoids ?? []).includes(p.properties.GEOID) &&
        d3.geoContains(county, [Number(p.properties.INTPTLON), Number(p.properties.INTPTLAT)]),
    );

    let features;
    if (region.singleFeatureName) {
      // An independent city: exactly one place shares its boundary.
      if (members.length !== 1) {
        throw new Error(`${region.root}: expected 1 place inside ${region.countyFips}, got ${members.length}`);
      }
      features = [toSourceFeature(members[0], region.singleFeatureName)];
    } else {
      // BASENAME ("Reston", not "Reston CDP") is how the catalog writes
      // them. Where two places in one county share a basename (Chevy
      // Chase is both a town and a CDP) both fall back to the Census's
      // full NAME, so neither silently takes the plain name.
      const basenameCounts = new Map();
      for (const p of members) {
        basenameCounts.set(p.properties.BASENAME, (basenameCounts.get(p.properties.BASENAME) ?? 0) + 1);
      }
      const nameOf = (p) => (basenameCounts.get(p.properties.BASENAME) > 1 ? p.properties.NAME : p.properties.BASENAME);
      features = members
        .map((p) => toSourceFeature(p, nameOf(p)))
        .sort((a, b) => a.properties.name.localeCompare(b.properties.name));
    }
    // Measured before the remainder is added, so it reports what the
    // places alone cover.
    const covered = features.reduce((sum, f) => sum + d3.geoArea(f), 0) / d3.geoArea(county);
    if (!region.singleFeatureName) {
      features.unshift({
        type: "Feature",
        properties: { name: `Rest of ${region.root}`, geoid: county.properties.GEOID, remainder: true },
        geometry: county.geometry,
      });
    }
    for (const f of features) tagged.push({ ...f, properties: { ...f.properties, region: regionIndex } });
    console.log(`  ${region.root}: ${features.length} feature(s); Census places cover ~${Math.round(covered * 100)}% of it`);
  }

  let topo = presimplify(topology({ suburbs: { type: "FeatureCollection", features: tagged } }, 1e6));
  topo = simplify(topo, SIMPLIFY_WEIGHT);
  const simplified = feature(topo, topo.objects.suburbs).features;

  const primary = CITIES[cityKey].primary;
  if (primary) {
    const [place] = (
      await Promise.all(PLACE_LAYERS.map((layer) => query(layer, `GEOID = '${primary.geoid}'`)))
    ).flat();
    if (!place) throw new Error(`${primary.name}: Census place ${primary.geoid} not returned by TIGERweb`);
    let outlineTopo = presimplify(
      topology({ outline: { type: "FeatureCollection", features: [toSourceFeature(place, primary.name)] } }, 1e6),
    );
    outlineTopo = simplify(outlineTopo, SIMPLIFY_WEIGHT);
    const outline = feature(outlineTopo, outlineTopo.objects.outline).features;
    writeFileSync(
      path.join(SOURCES_DIR, primary.sourceFile),
      JSON.stringify({ type: "FeatureCollection", features: outline }, null, 1) + "\n",
    );
    console.log(`  -> ${primary.sourceFile} (${primary.name} outline)`);
  }

  for (const [regionIndex, region] of regions.entries()) {
    const features = simplified
      .filter((f) => f.properties.region === regionIndex)
      .map(({ properties: { region: _region, ...properties }, geometry }) => ({ type: "Feature", properties, geometry }));
    writeFileSync(
      path.join(SOURCES_DIR, region.sourceFile),
      JSON.stringify({ type: "FeatureCollection", features }, null, 1) + "\n",
    );
    console.log(`  -> ${region.sourceFile}`);
  }
}

async function main() {
  const requested = process.argv.slice(2);
  const withSuburbs = Object.keys(CITIES).filter((key) => (CITIES[key].suburbs ?? []).length > 0);
  for (const key of requested) {
    if (!withSuburbs.includes(key)) {
      console.error(`"${key}" has no suburbs configured. Cities with suburbs: ${withSuburbs.join(", ")}`);
      process.exit(1);
    }
  }
  for (const key of requested.length > 0 ? requested : withSuburbs) await fetchCity(key);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
