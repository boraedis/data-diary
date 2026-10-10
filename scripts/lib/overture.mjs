/**
 * Shared by the scripts that build a city overlay from Overture Maps
 * (scripts/geo-build-water.mjs, scripts/geo-build-roads.mjs): reading a
 * theme's GeoParquet straight from Overture's public S3 bucket with
 * hyparquet, pruned by row-group bounding boxes, and clipping a geometry to
 * a lon/lat box. See geo-build-water.mjs's header for why this route and
 * not DuckDB or a download.
 */
import * as d3 from "d3";
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { fixWinding } from "./geo-winding.mjs";

/** Overture release the committed files were built from. Pinned so a
 * rebuild is reproducible and SOURCES.json can say exactly what's in the
 * repo; bump it deliberately. Overture keeps only the last few releases
 * in the bucket, so an old pin eventually 404s — that's the prompt to
 * bump, not a reason to float on "latest". */
export const OVERTURE_RELEASE = "2026-09-23.1";
export const OVERTURE_BUCKET = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com";
 
function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

/** A GeoJSON geometry clipped to [x0, y0, x1, y1] in lon/lat, or null if
 * nothing of it falls inside.
 *
 * d3's clip emits a polygon as a flat run of rings without saying which
 * are holes, so they're re-grouped here by winding: after `fixWinding`
 * every exterior is clockwise in lon/lat and every hole counterclockwise
 * (d3's spherical convention — see geo-winding.mjs), and clipping
 * preserves orientation. Each hole is then attached to the exterior that
 * contains it. */
export function clipGeometry(geometry, [x0, y0, x1, y1]) {
  // reflectY so the clip sees screen orientation (y down), which is what
  // its rectangle-corner containment test assumes; the extent is given in
  // that reflected space, and every point is flipped back on the way out.
  const clipper = d3.geoIdentity().reflectY(true).clipExtent([[x0, -y1], [x1, -y0]]);
  const rings = [];
  const lines = [];
  let current = null;
  let inPolygon = false;
  const sink = {
    point(x, y) {
      current.push([x, -y]);
    },
    lineStart() {
      current = [];
    },
    lineEnd() {
      if (inPolygon) rings.push(current);
      else if (current.length > 1) lines.push(current);
      current = null;
    },
    polygonStart() {
      inPolygon = true;
    },
    polygonEnd() {
      inPolygon = false;
    },
    sphere() {},
  };
  d3.geoStream({ type: "Feature", geometry: fixWinding(geometry), properties: {} }, clipper.stream(sink));

  if (lines.length > 0) return { type: "MultiLineString", coordinates: lines };
  if (rings.length === 0) return null;

  // d3's clip emits rings unclosed; GeoJSON wants first === last.
  const closed = rings
    .filter((r) => r.length >= 3)
    .map((r) => (r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1] ? r : [...r, r[0]]));
  const exteriors = closed.filter((r) => signedArea(r) < 0);
  const holes = closed.filter((r) => signedArea(r) > 0);
  if (exteriors.length === 0) return null;
  const polygons = exteriors.map((r) => [r]);
  for (const hole of holes) {
    const owner = polygons.find(([ext]) => d3.polygonContains(ext, hole[0]));
    // A hole with no exterior around it can only be a sliver the clip cut
    // loose from its polygon; dropping it can't remove any water.
    owner?.push(hole);
  }
  return { type: "MultiPolygon", coordinates: polygons };
}


/** Every object key under `prefix` (e.g. "release/<v>/theme=base/type=water/").
 * S3's ListObjectsV2 caps a page at 1,000 keys; a layer is ~128 files, but
 * paging costs nothing. */
async function listFiles(prefix) {
  const keys = [];
  let token = null;
  do {
    const url = new URL(OVERTURE_BUCKET);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const res = await withRetry("list", () => fetch(url));
    if (!res.ok) throw new Error(`${res.status} listing ${url} — is OVERTURE_RELEASE still published?`);
    const xml = await res.text();
    keys.push(...[...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]).filter((k) => k.endsWith(".parquet")));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]+)</)?.[1] : null;
  } while (token);
  if (keys.length === 0) throw new Error(`No files under ${prefix} — is OVERTURE_RELEASE still published?`);
  return keys;
}

/** A row group's own [xmin, ymin, xmax, ymax] from its column statistics,
 * or null if they're missing (then it can't be pruned, only read). */
function rowGroupBox(rowGroup) {
  const stat = (name, which) =>
    rowGroup.columns.find((c) => c.meta_data?.path_in_schema.join(".") === `bbox.${name}`)?.meta_data?.statistics?.[which];
  const box = [stat("xmin", "min_value"), stat("ymin", "min_value"), stat("xmax", "max_value"), stat("ymax", "max_value")];
  return box.every((v) => typeof v === "number") ? box : null;
}

export function boxesOverlap(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/** Overture's bucket drops a connection now and then ("other side closed")
 * across the hundreds of range requests a layer takes; every such failure
 * seen so far succeeded on a retry. Wrapped per request rather than per file
 * so a retry never re-reads rows already collected. */
async function withRetry(label, fn, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.warn(`  ${label}: ${err instanceof Error ? err.message : err}; retrying (${attempt}/${attempts - 1})`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/**
 * The rows of one Overture layer overlapping any of `boxes`, grouped per
 * box. One pass over the layer for every box at once, so each file's footer
 * and each overlapping row group is fetched once however many boxes share
 * it.
 *
 * `keep` runs on each row as it's read, before it's retained: a roads layer
 * is mostly footpaths and driveways, and holding every row of a metro just
 * to discard most of them later is what would run a build out of memory.
 */
export async function fetchLayerRows({ theme, type, columns, boxes, keep = () => true }) {
  const keys = await listFiles(`release/${OVERTURE_RELEASE}/theme=${theme}/type=${type}/`);
  const rowsPerBox = boxes.map(() => []);
  let groupsRead = 0;
  for (const key of keys) {
    const file = await withRetry(key, () => asyncBufferFromUrl({ url: `${OVERTURE_BUCKET}/${key}` }));
    const metadata = await withRetry(key, () => parquetMetadataAsync(file));
    let rowStart = 0;
    for (const rowGroup of metadata.row_groups) {
      const rowEnd = rowStart + Number(rowGroup.num_rows);
      const groupBox = rowGroupBox(rowGroup);
      const wanted = boxes.map((b) => !groupBox || boxesOverlap(groupBox, b));
      if (wanted.some(Boolean)) {
        groupsRead++;
        const rows = await withRetry(key, () =>
          parquetReadObjects({
            file,
            metadata,
            columns: [...columns, "bbox"],
            rowStart,
            rowEnd,
            compressors,
          }),
        );
        for (const row of rows) {
          if (!keep(row)) continue;
          const rowBox = [row.bbox.xmin, row.bbox.ymin, row.bbox.xmax, row.bbox.ymax];
          boxes.forEach((b, i) => {
            if (wanted[i] && boxesOverlap(rowBox, b)) rowsPerBox[i].push(row);
          });
        }
      }
      rowStart = rowEnd;
    }
  }
  console.log(`  read ${groupsRead} row groups from ${keys.length} files`);
  return rowsPerBox;
}
