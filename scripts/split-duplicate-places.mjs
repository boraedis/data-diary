#!/usr/bin/env node
/**
 * One-time repair for the "same name, two different hierarchy levels" bug
 * (2026-08-29) — e.g. Emirate "Dubai" containing City "Dubai".
 *
 * ROOT CAUSE: migrate-history.mjs originally upserted `places` keyed by
 * `name` alone (`on conflict (name) do update ... returning id`), because
 * the schema had `name` as globally unique. Real geography routinely reuses
 * a name at two different tree levels, so any such pair collapsed into ONE
 * Postgres row — and then the hierarchy pass (applyPlaceHierarchy), which
 * runs child-before-parent-write for a `parent -> child` edge where both
 * ends now resolve to the same row, ended up writing
 * `UPDATE places SET parent_id = X WHERE id = X` — a literal self-reference.
 * `scripts/diagnose-place-cycles.mjs` finds exactly these self-loops.
 *
 * The schema no longer enforces global name uniqueness (see the `places`
 * table comment in schema.ts — the real constraint is now (name, parentId)),
 * so this script's job is purely to repair the historical damage: for every
 * self-referencing place, go back to the original Firestore data, figure
 * out which TWO distinct places got merged, split them into two real rows,
 * and re-point both their own parent and any of their real children
 * (venues, etc. — anything currently parented under the merged row) to
 * wherever they actually belong.
 *
 * Requires the same inputs as migrate-history.mjs, for the same reason (see
 * that script's header) — it needs live Firestore access, which this
 * sandbox has none of:
 *
 *   FIREBASE_SERVICE_ACCOUNT=/path/to/service-account.json \
 *   DATABASE_URL=postgres://... \
 *   node scripts/split-duplicate-places.mjs [--commit]
 *
 * Defaults to a DRY RUN — prints exactly what it would do (which row stays,
 * what its corrected parent would be, what new row would be created and
 * with what fields, and which existing children would be re-pointed to
 * which side of the split) but writes nothing. Pass --commit to write.
 *
 * Safe to re-run: once a name's self-loop is fixed, it no longer matches
 * this script's "needs repair" condition (parent_id === own id), so a
 * second run is a no-op for it.
 *
 * Run scripts/backfill-place-paths.mjs again afterward — every place this
 * script touches (and anything downstream of it) needs its id_path/
 * name_path recomputed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import admin from "firebase-admin";
import pg from "pg";

const COMMIT = process.argv.slice(2).includes("--commit");

const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountPath) {
  console.error("Set FIREBASE_SERVICE_ACCOUNT to the path of the legacy service account key JSON.");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to your Neon Postgres connection string.");
  process.exit(1);
}

console.log(`\n=== split-duplicate-places — ${COMMIT ? "COMMIT" : "DRY RUN"} ===\n`);
if (!COMMIT) console.log("(dry run — nothing will be written; pass --commit to write)\n");

const serviceAccount = JSON.parse(readFileSync(path.resolve(serviceAccountPath), "utf8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const fs = admin.firestore();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/** Same shape/logic as migrate-history.mjs's migratePlaces field computation
 * — kept in sync deliberately so a place computed here matches what the
 * original migration would have produced for it. */
function computeFields(d, coordinates, fsId, metroIdByName) {
  const name = (d.name || "").trim();
  const address = d.category === "Region" ? name : [d.street_num, d.street_name].filter(Boolean).join(" ").trim() || null;
  let metroId = null;
  if (d.metro) metroId = metroIdByName.get(d.metro) ?? null;
  const coord = coordinates[fsId];
  const lat = coord && typeof coord.lat === "number" ? coord.lat : null;
  const lng = coord && typeof coord.lng === "number" ? coord.lng : null;
  return {
    name,
    alias: d.alias || null,
    address,
    category: d.category || null,
    subcategory: d.subcategory || null,
    subregionName: d.subregion_name || null,
    color: d.color || null,
    metroId,
    lat,
    lng,
  };
}

const COMPARE_KEYS = ["alias", "address", "category", "subcategory", "subregionName", "color", "metroId", "lat", "lng"];

/** How many of COMPARE_KEYS match between a Postgres row and a computed
 * Firestore-candidate field set — used to guess which of two colliding
 * fsIds the surviving merged row currently represents. */
function matchScore(pgRow, candidate) {
  let score = 0;
  for (const key of COMPARE_KEYS) {
    const pgVal = pgRow[key] ?? null;
    const candVal = candidate[key] ?? null;
    if (pgVal === candVal) score++;
  }
  return score;
}

/** Mirrors fetchWorldParentMap in migrate-history.mjs exactly. */
async function fetchWorldParentMap() {
  const snap = await fs.collection("world").get();
  const parentMap = new Map();
  function walk(node, parentPlaceFsId) {
    if (!node || typeof node !== "object") return;
    const placeFsId = node.id;
    if (placeFsId) {
      if (parentPlaceFsId) parentMap.set(placeFsId, parentPlaceFsId);
      if (node.regions) {
        for (const childName of Object.keys(node.regions)) walk(node.regions[childName], placeFsId);
      }
    } else if (node.regions) {
      for (const childName of Object.keys(node.regions)) walk(node.regions[childName], null);
    }
  }
  for (const countryDoc of snap.docs) walk(countryDoc.data(), null);
  return parentMap;
}

async function main() {
  console.log("Reading Firestore places, world hierarchy, and coordinates...");
  const [placesSnap, worldParentMap, coordDoc, metrosRes, pgPlacesRes] = await Promise.all([
    fs.collection("places").get(),
    fetchWorldParentMap(),
    fs.collection("searchs").doc("coordinates").get(),
    pool.query("SELECT id, name FROM metros"),
    pool.query("SELECT id, name, alias, address, category, subcategory, subregion_name AS \"subregionName\", color, metro_id AS \"metroId\", lat, lng, parent_id AS \"parentId\" FROM places"),
  ]);
  const coordinates = coordDoc.data() || {};
  const metroIdByName = new Map(metrosRes.rows.map((r) => [r.name, r.id]));

  // fsId -> raw Firestore data, and name -> [fsId,...]
  const fsDataById = new Map();
  const fsIdsByName = new Map();
  for (const doc of placesSnap.docs) {
    const d = doc.data();
    const name = (d.name || "").trim();
    if (!name) continue;
    fsDataById.set(doc.id, d);
    if (!fsIdsByName.has(name)) fsIdsByName.set(name, []);
    fsIdsByName.get(name).push(doc.id);
  }

  const pgRows = pgPlacesRes.rows;
  const pgById = new Map(pgRows.map((r) => [r.id, r]));

  // The bug's exact fingerprint: a row whose parent_id is its own id.
  const selfLoops = pgRows.filter((r) => r.parentId === r.id);
  console.log(`\n${pgRows.length} places in Postgres, ${selfLoops.length} self-referencing (need repair).\n`);

  if (selfLoops.length === 0) {
    console.log("Nothing to do.");
    await pool.end();
    return;
  }

  const report = { fixed: 0, skipped: 0, newRows: 0, reparentedChildren: 0 };

  for (const row of selfLoops) {
    const candidates = fsIdsByName.get(row.name) || [];
    if (candidates.length < 2) {
      console.warn(`SKIP ${row.id} (${row.name}): self-referencing but Firestore has ${candidates.length} place(s) with this name — expected 2. Needs manual review.`);
      report.skipped++;
      continue;
    }

    // Find the pair among `candidates` connected by a direct edge in the
    // world tree (worldParentMap.get(child) === parent).
    let parentFsId = null;
    let childFsId = null;
    outer: for (const a of candidates) {
      for (const b of candidates) {
        if (a === b) continue;
        if (worldParentMap.get(b) === a) {
          parentFsId = a;
          childFsId = b;
          break outer;
        }
      }
    }
    if (!parentFsId) {
      console.warn(`SKIP ${row.id} (${row.name}): found ${candidates.length} same-named Firestore places but no direct parent/child edge between any pair in the world tree. Needs manual review. Candidate fsIds: ${candidates.join(", ")}`);
      report.skipped++;
      continue;
    }

    const parentFields = computeFields(fsDataById.get(parentFsId), coordinates, parentFsId, metroIdByName);
    const childFields = computeFields(fsDataById.get(childFsId), coordinates, childFsId, metroIdByName);
    const scoreParent = matchScore(row, parentFields);
    const scoreChild = matchScore(row, childFields);
    const existingIsParent = scoreParent >= scoreChild;
    const tie = scoreParent === scoreChild;

    const keepFsId = existingIsParent ? parentFsId : childFsId;
    const newFsId = existingIsParent ? childFsId : parentFsId;
    const newFields = existingIsParent ? childFields : parentFields;

    console.log(
      `${row.id} (${row.name}): keeping row ${row.id} as ${existingIsParent ? "PARENT" : "CHILD"} ` +
        `(matched ${existingIsParent ? scoreParent : scoreChild}/${COMPARE_KEYS.length} fields${tie ? ", TIE — verify this guess" : ""}), ` +
        `creating a new row for the ${existingIsParent ? "CHILD" : "PARENT"} (fsId ${newFsId}, name "${newFields.name}").`
    );

    // Resolve the grandparent (world-tree parent of parentFsId), by name —
    // every non-colliding name has exactly one Postgres row.
    let grandparentPgId = null;
    const grandparentFsId = worldParentMap.get(parentFsId);
    if (grandparentFsId) {
      const grandparentName = (fsDataById.get(grandparentFsId)?.name || "").trim();
      const matches = pgRows.filter((r) => r.name === grandparentName);
      if (matches.length === 1) {
        grandparentPgId = matches[0].id;
      } else {
        console.warn(
          `  ! Couldn't uniquely resolve "${row.name}"'s real parent ("${grandparentName}") in Postgres (found ${matches.length} match(es)) — leaving ${existingIsParent ? "row " + row.id : "the new row"}'s parent unset. Fix manually.`
        );
      }
    }

    let keptRowNewParentId;
    let newRowParentId;
    if (existingIsParent) {
      keptRowNewParentId = grandparentPgId; // row's own real parent (or null if a root)
      newRowParentId = row.id; // the split-out child's parent is the kept row
    } else {
      // existing row is the CHILD; new row is the PARENT and needs the
      // grandparent, then the kept (child) row's parent becomes the new row.
      newRowParentId = grandparentPgId;
      keptRowNewParentId = "NEW_ROW_ID"; // resolved after insert, below
    }

    // Any real (non-self) existing children of the merged row need
    // re-pointing to whichever side of the split they actually belong to.
    const existingChildren = pgRows.filter((r) => r.parentId === row.id && r.id !== row.id);
    const reparentPlan = [];
    for (const child of existingChildren) {
      const childFsCandidates = fsIdsByName.get(child.name) || [];
      // Usually unambiguous (one fsId for this name); if the child's name
      // is ALSO a collision name, skip it for manual review rather than
      // guessing two levels deep in one pass.
      if (childFsCandidates.length !== 1) {
        console.warn(`  ! ${child.id} (${child.name}) is currently a child of ${row.id} and its own name isn't unique in Firestore either — leaving it under ${row.id} for now, review manually.`);
        continue;
      }
      const trueParentFsId = worldParentMap.get(childFsCandidates[0]);
      if (trueParentFsId === childFsId) {
        reparentPlan.push({ child, belongsTo: "new-or-kept-child-side" });
      } else if (trueParentFsId === parentFsId) {
        reparentPlan.push({ child, belongsTo: "new-or-kept-parent-side" });
      }
      // else: belongs to neither side of this split (shouldn't happen since
      // it's currently parented at `row`) — leave alone, defensive no-op.
    }

    if (COMMIT) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const { rows: insertedRows } = await client.query(
          `INSERT INTO places (name, alias, address, category, subcategory, parent_id, subregion_name, color, metro_id, lat, lng)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING id`,
          [
            newFields.name,
            newFields.alias,
            newFields.address,
            newFields.category,
            newFields.subcategory,
            typeof newRowParentId === "number" ? newRowParentId : null,
            newFields.subregionName,
            newFields.color,
            newFields.metroId,
            newFields.lat,
            newFields.lng,
          ]
        );
        const newRowId = insertedRows[0].id;
        report.newRows++;

        const finalKeptParentId = keptRowNewParentId === "NEW_ROW_ID" ? newRowId : keptRowNewParentId;
        await client.query(`UPDATE places SET parent_id = $1 WHERE id = $2`, [finalKeptParentId, row.id]);

        const parentSidePgId = existingIsParent ? row.id : newRowId;
        const childSidePgId = existingIsParent ? newRowId : row.id;
        for (const { child, belongsTo } of reparentPlan) {
          const target = belongsTo === "new-or-kept-child-side" ? childSidePgId : parentSidePgId;
          if (target !== child.parentId) {
            await client.query(`UPDATE places SET parent_id = $1 WHERE id = $2`, [target, child.id]);
            report.reparentedChildren++;
          }
        }

        await client.query("COMMIT");
        console.log(`  -> committed: new row id ${newRowId}, kept row ${row.id} parent -> ${finalKeptParentId ?? "(root)"}.`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } else {
      console.log(
        `  -> would set row ${row.id}'s parent to ${existingIsParent ? grandparentPgId ?? "(root)" : "<new row id>"}, ` +
          `create a new row parented at ${existingIsParent ? row.id : grandparentPgId ?? "(root)"}` +
          (reparentPlan.length ? `, and re-point ${reparentPlan.length} existing child place(s).` : ".")
      );
    }

    report.fixed++;
  }

  console.log(
    `\nDone. ${report.fixed} name(s) repaired${COMMIT ? "" : " (dry run, nothing written)"}, ${report.skipped} skipped (manual review needed)` +
      (COMMIT ? `, ${report.newRows} new row(s) created, ${report.reparentedChildren} child place(s) re-pointed.` : ".")
  );
  if (COMMIT) {
    console.log("\nNow re-run `npm run backfill:place-paths` to recompute id_path/name_path for everything this touched.");
  } else {
    console.log("\nReview the plan above, then re-run with --commit to apply it.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
