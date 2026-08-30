/**
 * One-time backfill for `places.id_path` / `places.name_path`.
 *
 * Those two columns are maintained going forward by
 * createPlaceCatalogEntry/updatePlaceCatalogEntry (see src/lib/days.ts and
 * the `places` table comment in src/db/schema.ts) — but they only get set
 * on a create or an update. Any place row that existed before those
 * columns were added (i.e. every place in the catalog today) has them
 * null until either it's re-saved through the app, or this script runs
 * once against that database.
 *
 * Run it once per database, any time after the schema migration lands and
 * before you rely on path search/display actually working there:
 *
 *   DATABASE_URL=postgres://... node scripts/backfill-place-paths.mjs
 *
 * Safe to re-run — it always recomputes every row from current
 * name/parent_id, so re-running after further edits just re-syncs
 * everything (equivalent to, but cheaper than, re-saving every place).
 */
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string to backfill.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // This script writes unconditionally (no --commit flag to gate on), so
  // the prod check has to run before anything else — see
  // scripts/lib/prod-guard.mjs for why this exists.
  await guardAgainstProd({ scriptName: "backfill-place-paths.mjs" });

  const { rows } = await pool.query("SELECT id, name, parent_id FROM places");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenByParent = new Map();
  for (const row of rows) {
    const key = row.parent_id;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(row);
  }

  // Guard against a corrupted cycle the same way getPlaceAncestry does —
  // shouldn't happen given updatePlaceCatalogEntry's own-subtree check,
  // but this walks defensively regardless.
  const roots = childrenByParent.get(null) ?? [];
  let updated = 0;
  let frontier = roots.map((r) => ({ row: r, idPath: "", namePath: "" }));
  const visited = new Set();

  while (frontier.length > 0) {
    const next = [];
    for (const { row, idPath: parentIdPath, namePath: parentNamePath } of frontier) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      const idPath = `${parentIdPath}${row.id}/`;
      const namePath = `${parentNamePath}${row.name}/`;
      await pool.query("UPDATE places SET id_path = $1, name_path = $2 WHERE id = $3", [idPath, namePath, row.id]);
      updated += 1;
      for (const child of childrenByParent.get(row.id) ?? []) {
        next.push({ row: child, idPath, namePath });
      }
    }
    frontier = next;
  }

  const orphaned = rows.filter((r) => !visited.has(r.id));
  if (orphaned.length > 0) {
    console.warn(
      `Skipped ${orphaned.length} place(s) unreachable from a root (parent_id cycle or dangling reference):`,
      orphaned.map((r) => `${r.id} (${r.name})`).join(", ")
    );
  }

  console.log(`Backfilled path for ${updated}/${rows.length} places.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
