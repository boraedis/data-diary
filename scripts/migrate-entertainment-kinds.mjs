#!/usr/bin/env node
/**
 * One-time schema migration: replaces entertainment_catalog.kind (a fixed
 * Postgres enum — movie/tvshow/sport/book/game) with a real
 * entertainment_kinds table + entertainment_catalog.kind_id FK, so a user
 * can add their own "neutral" kinds (the manage-entertainment "+ New kind"
 * flow) without a schema migration for every one. Same
 * grow-a-free-text-catalog-into-a-real-FK-table shape already used for
 * `tags` (see that table's comment in schema.ts) — the difference here is
 * `entertainment_catalog.kind` already had a live NOT NULL enum column
 * with real historical data in it (rows logged back when this generic
 * catalog was the only place any entertainment got tracked, before movies/
 * tvShows/sports/books got their own dedicated tables), so this is an
 * in-place ALTER + backfill, not a fresh table designed before any data
 * existed.
 *
 * What it does (all in one transaction — see below for why):
 *   1. CREATE TABLE entertainment_kinds (id, name, is_system, created_at)
 *      if it doesn't exist yet.
 *   2. Seed the five system kinds (Movie/TV show/Sport/Book/Game),
 *      isSystem = true, matching the old enum's five values.
 *   3. Add entertainment_catalog.kind_id (nullable at first).
 *   4. Backfill kind_id from the old kind column for every existing row.
 *   5. Verify no row was left with kind_id NULL — abort (rolling back
 *      everything) rather than continue if any were, so you never end up
 *      with a NOT NULL constraint you can't actually satisfy.
 *   6. Make kind_id NOT NULL, swap the (kind, title) unique index for
 *      (kind_id, title), drop the old kind column and its enum type.
 *
 * Run it once per database, after this batch of code (schema.ts,
 * src/lib/days.ts, src/lib/catalog-admin.ts, and everything under
 * src/components/manage + src/components/entry-forms that reads/writes
 * entertainment kinds) is deployed there — the app code already expects
 * kind_id, not kind, so don't run this against a database the OLD code is
 * still reading from.
 *
 *   DATABASE_URL=postgres://... node scripts/migrate-entertainment-kinds.mjs [--commit]
 *
 * Defaults to a DRY RUN — connects, inspects the current schema, and
 * prints exactly what it would do, but writes nothing. Pass --commit to
 * write.
 *
 * Safe to re-run: every step below checks current state first (does the
 * table/column already exist, is there anything left to backfill) and
 * skips what's already done — a second run after a successful commit is a
 * no-op ("already migrated").
 *
 * Wrapped in a single BEGIN/COMMIT (unlike split-duplicate-places.mjs,
 * which commits row-by-row) — Postgres DDL is transactional, and there's
 * no reason to risk landing half-migrated (kind_id added and backfilled,
 * but the old column still there, or vice versa) if something fails
 * partway through. Either the whole thing lands, or none of it does.
 *
 * 2026-08-30 fix: the dry-run preview used to unconditionally query
 * `WHERE kind_id IS NULL` for the backfill-count and NULL-check previews.
 * That's fine once kind_id exists, but a dry run against a database that
 * doesn't have kind_id yet (kind_id only actually gets added when
 * --commit runs the ALTER TABLE) crashed with "column kind_id does not
 * exist" — i.e. dry-run mode couldn't even preview a from-scratch
 * migration, only a re-run of one already in progress. Fixed by only
 * querying kind_id when it's actually queryable (already existed, or
 * --commit just added it in this same transaction), and skipping the
 * post-backfill NULL verification entirely in dry-run mode, since nothing
 * was written to verify.
 */
import pg from "pg";
import { guardAgainstProd } from "./lib/prod-guard.mjs";

const COMMIT = process.argv.slice(2).includes("--commit");

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string to migrate.");
  process.exit(1);
}

// Old enum value -> new entertainment_kinds.name. The display name IS the
// name now (no separate label map anywhere in the app — see
// ENTERTAINMENT_KIND_LABELS's removal), so this seeds the nicely-cased
// names directly rather than the old lowercase enum values.
const SYSTEM_KINDS = [
  { enumValue: "movie", name: "Movie" },
  { enumValue: "tvshow", name: "TV show" },
  { enumValue: "sport", name: "Sport" },
  { enumValue: "book", name: "Book" },
  { enumValue: "game", name: "Game" },
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(client, table) {
  const { rows } = await client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [table]);
  return rows.length > 0;
}

async function main() {
  console.log(`\n=== migrate-entertainment-kinds — ${COMMIT ? "COMMIT" : "DRY RUN"} ===\n`);
  if (!COMMIT) console.log("(dry run — nothing will be written; pass --commit to write)\n");

  const client = await pool.connect();
  try {
    const kindsTableExists = await tableExists(client, "entertainment_kinds");
    const hasOldKindColumn = await columnExists(client, "entertainment_catalog", "kind");
    const hasKindIdColumn = await columnExists(client, "entertainment_catalog", "kind_id");

    if (kindsTableExists && !hasOldKindColumn && hasKindIdColumn) {
      console.log("Already migrated — entertainment_kinds exists, entertainment_catalog.kind_id exists, entertainment_catalog.kind is gone. Nothing to do.");
      return;
    }

    if (!hasOldKindColumn && !hasKindIdColumn) {
      console.error(
        "entertainment_catalog has neither `kind` nor `kind_id` — this database's schema doesn't match what this script expects. Stopping without changing anything; needs manual review."
      );
      process.exitCode = 1;
      return;
    }

    console.log(`entertainment_kinds table exists: ${kindsTableExists}`);
    console.log(`entertainment_catalog.kind (old enum column) exists: ${hasOldKindColumn}`);
    console.log(`entertainment_catalog.kind_id exists: ${hasKindIdColumn}`);

    if (COMMIT) await guardAgainstProd({ scriptName: "migrate-entertainment-kinds.mjs --commit" });

    if (COMMIT) await client.query("BEGIN");

    // --- 1 & 2: entertainment_kinds table + seed ---------------------------
    if (!kindsTableExists) {
      console.log("\nWould create table entertainment_kinds (id, name, is_system, created_at).");
      if (COMMIT) {
        await client.query(`
          CREATE TABLE entertainment_kinds (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            is_system BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `);
      }
    }
    console.log(`Would seed ${SYSTEM_KINDS.length} system kinds: ${SYSTEM_KINDS.map((k) => k.name).join(", ")} (skipping any that already exist by name).`);
    if (COMMIT) {
      for (const { name } of SYSTEM_KINDS) {
        await client.query(
          `INSERT INTO entertainment_kinds (name, is_system) VALUES ($1, true) ON CONFLICT (name) DO NOTHING`,
          [name]
        );
      }
    }

    // --- 3 & 4: kind_id column + backfill -----------------------------------
    if (hasOldKindColumn) {
      if (!hasKindIdColumn) {
        console.log("\nWould add entertainment_catalog.kind_id (nullable, FK -> entertainment_kinds.id).");
        if (COMMIT) {
          await client.query(
            `ALTER TABLE entertainment_catalog ADD COLUMN kind_id INTEGER REFERENCES entertainment_kinds(id)`
          );
        }
      }

      // kind_id is only actually queryable at this point if it already
      // existed before this run, or --commit just added it above. In a
      // dry run against a database that doesn't have it yet, it's still
      // absent — "WHERE kind_id IS NULL" would itself error — so fall
      // back to a plain row count for the preview (every row would need
      // backfilling in that case, since kind_id doesn't exist at all).
      const kindIdQueryable = hasKindIdColumn || COMMIT;
      const { rows: toBackfill } = kindIdQueryable
        ? await client.query(`SELECT count(*) FROM entertainment_catalog WHERE kind_id IS NULL`)
        : await client.query(`SELECT count(*) FROM entertainment_catalog`);
      console.log(`Would backfill kind_id for ${toBackfill[0].count} row(s) from the old kind column.`);

      if (COMMIT) {
        for (const { enumValue, name } of SYSTEM_KINDS) {
          await client.query(
            `UPDATE entertainment_catalog SET kind_id = (SELECT id FROM entertainment_kinds WHERE name = $1)
             WHERE kind::text = $2 AND kind_id IS NULL`,
            [name, enumValue]
          );
        }

        // --- 5: verify before making anything irreversible ------------------
        // Only meaningful once a backfill has actually run in this
        // transaction — in a dry run there's nothing written yet to check,
        // and kind_id may not even exist to query (see above).
        const { rows: stillNull } = await client.query(
          `SELECT id, kind::text AS kind FROM entertainment_catalog WHERE kind_id IS NULL`
        );
        if (stillNull.length > 0) {
          console.error(
            `\n${stillNull.length} row(s) still have kind_id NULL after backfill — unexpected kind value(s): ` +
              `${[...new Set(stillNull.map((r) => r.kind))].join(", ")}. Aborting and rolling back rather than ` +
              "leaving a NOT NULL constraint half-satisfied. Needs manual review."
          );
          await client.query("ROLLBACK");
          process.exitCode = 1;
          return;
        }
      } else {
        console.log("Would then verify no row was left with kind_id NULL before proceeding (skipped in a dry run — nothing's been written yet to check).");
      }

      // --- 6: contract — NOT NULL, swap the unique index, drop the old column/enum
      console.log("\nWould set entertainment_catalog.kind_id NOT NULL.");
      console.log("Would replace the (kind, title) unique index with (kind_id, title).");
      console.log("Would drop entertainment_catalog.kind and the entertainment_kind enum type.");
      if (COMMIT) {
        await client.query(`ALTER TABLE entertainment_catalog ALTER COLUMN kind_id SET NOT NULL`);
        await client.query(`DROP INDEX IF EXISTS entertainment_catalog_kind_title_idx`);
        await client.query(
          `CREATE UNIQUE INDEX entertainment_catalog_kind_title_idx ON entertainment_catalog (kind_id, title)`
        );
        await client.query(`ALTER TABLE entertainment_catalog DROP COLUMN kind`);
        await client.query(`DROP TYPE IF EXISTS entertainment_kind`);
      }
    } else {
      console.log("\nOld kind column is already gone — nothing left to backfill or drop.");
    }

    if (COMMIT) {
      await client.query("COMMIT");
      console.log("\nDone — committed.");
    } else {
      console.log("\nReview the plan above, then re-run with --commit to apply it.");
    }
  } catch (err) {
    if (COMMIT) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // connection may already be unusable after the original error — ignore
      }
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
