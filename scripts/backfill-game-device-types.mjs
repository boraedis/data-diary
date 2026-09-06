/**
 * One-time remap of game_sessions.device_type from the two ad-hoc values
 * the legacy Firestore migration produced ("Iphone", "Macbook") to the
 * small, generic set actually wanted (#137): "Mobile" and "Computer"
 * respectively.
 *
 * game_sessions.device_type is plain free text matched by name against the
 * game_device_types catalog (see schema.ts's comment on gameDeviceTypes) —
 * there's no foreign key, so renaming a catalog row via the manage UI's
 * "+ New device type" picker only changes the catalog label; it never
 * touches text already stored on existing session rows. These two legacy
 * values had no way to move over without touching the rows directly.
 *
 * Also upserts every catalog row in the target set ("Mobile", "Console",
 * "Computer", "Board", "Other") so the manage UI's device-type picker has
 * the full generic list to choose from, whether or not you've already
 * added some of them by hand.
 *
 * Safe to re-run — every UPDATE is scoped to "... WHERE device_type = ...",
 * so once a value is remapped, a second run touches zero rows for it.
 *
 *   DATABASE_URL=postgres://... node scripts/backfill-game-device-types.mjs
 */
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";

const TARGET_CATALOG = ["Mobile", "Console", "Computer", "Board", "Other"];
const REMAP = {
  Iphone: "Mobile",
  Macbook: "Computer",
};

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string to backfill.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // This script writes unconditionally (no --commit flag to gate on), so
  // the prod check has to run before anything else — see
  // scripts/lib/prod-guard.mjs for why this exists.
  await guardAgainstProd({ scriptName: "backfill-game-device-types.mjs" });

  for (const name of TARGET_CATALOG) {
    const { rowCount } = await pool.query(
      `insert into game_device_types (name) values ($1) on conflict (name) do nothing`,
      [name]
    );
    console.log(`game_device_types: "${name}" ${rowCount > 0 ? "created" : "already exists"}`);
  }

  for (const [from, to] of Object.entries(REMAP)) {
    const { rowCount } = await pool.query(`update game_sessions set device_type = $1 where device_type = $2`, [
      to,
      from,
    ]);
    console.log(`\ngame_sessions.device_type: "${from}" -> "${to}": ${rowCount} row(s)`);
  }

  const { rows } = await pool.query(
    `select distinct device_type from game_sessions where device_type is not null order by 1`
  );
  const values = rows.map((r) => r.device_type);
  console.log(`\nDistinct device_type values now in game_sessions: ${values.join(", ") || "(none)"}`);

  const unexpected = values.filter((v) => !TARGET_CATALOG.includes(v));
  if (unexpected.length > 0) {
    console.log(
      `\n${unexpected.length} value(s) outside the target set (${TARGET_CATALOG.join("/")}): ${unexpected.join(", ")} — review manually, this script only knew about "Iphone" and "Macbook".`
    );
  } else {
    console.log("\nEvery game session now uses one of the generic device types.");
    console.log(
      'The old "Iphone"/"Macbook" catalog rows are unused now — delete them via the manage UI\'s device type page if you want them gone.'
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
