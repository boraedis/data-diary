/**
 * Read-only diagnostic for the "some places are missing id_path/name_path
 * after backfill-place-paths.mjs" issue.
 *
 * Why this can only be a parent_id CYCLE, not a dangling reference:
 * places.parentId has a real FK constraint (see schema.ts, `.references(...
 * onDelete: "restrict")`), so Postgres physically rejects any parent_id that
 * doesn't point at a real places row. And backfill-place-paths.mjs's BFS
 * pushes every child of every visited node unconditionally — so if a place's
 * parent is ever reachable from a root, the place itself is always reachable
 * too. That means the only way a place can be left "unreachable from a
 * root" is if walking up its parent chain never hits a null-parent root —
 * i.e. the chain loops back on itself somewhere.
 *
 * This script finds every such place, walks its parent chain, and prints
 * the exact cycle (which place points to which, all the way around) so you
 * can see precisely which parent_id link(s) are wrong and fix them (e.g. by
 * editing that one place's parent in the app, or nulling it out to make it
 * a root) before re-running backfill-place-paths.mjs.
 *
 * Read-only — makes no writes. Safe to run anytime.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/diagnose-place-cycles.mjs
 */
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the Postgres connection string to diagnose.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query("SELECT id, name, parent_id FROM places");
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenByParent = new Map();
  for (const row of rows) {
    const key = row.parent_id;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(row);
  }

  // Same BFS as backfill-place-paths.mjs, just without the writes.
  const roots = childrenByParent.get(null) ?? [];
  const visited = new Set();
  let frontier = [...roots];
  while (frontier.length > 0) {
    const next = [];
    for (const row of frontier) {
      if (visited.has(row.id)) continue;
      visited.add(row.id);
      for (const child of childrenByParent.get(row.id) ?? []) next.push(child);
    }
    frontier = next;
  }

  const orphaned = rows.filter((r) => !visited.has(r.id));
  console.log(`${rows.length} total places, ${visited.size} reachable from a root, ${orphaned.length} unreachable.\n`);

  if (orphaned.length === 0) {
    console.log("No unreachable places — nothing to fix.");
    await pool.end();
    return;
  }

  // Walk up the parent chain from each orphaned place until we revisit a
  // place we've already seen in THIS walk — that revisit is the cycle.
  // Group identical cycles together so e.g. 200 leaf venues under one
  // broken country link only get reported once.
  const cycleKeyByPlaceId = new Map(); // place id -> canonical cycle signature
  const cyclesBySignature = new Map(); // signature -> ordered array of {id, name}

  for (const start of orphaned) {
    if (cycleKeyByPlaceId.has(start.id)) continue;
    const chain = [];
    const seenAt = new Map(); // place id -> index in chain
    let current = start;
    for (;;) {
      if (seenAt.has(current.id)) {
        const cycle = chain.slice(seenAt.get(current.id));
        const signature = cycle
          .map((p) => p.id)
          .sort((a, b) => a - b)
          .join(",");
        if (!cyclesBySignature.has(signature)) cyclesBySignature.set(signature, cycle);
        for (const p of chain) cycleKeyByPlaceId.set(p.id, signature);
        break;
      }
      seenAt.set(current.id, chain.length);
      chain.push(current);
      const parent = current.parent_id === null ? null : byId.get(current.parent_id);
      if (!parent) {
        // Shouldn't happen (FK guarantees parent_id always resolves, and a
        // null parent_id makes `current` a root, which can't be orphaned) —
        // but report it plainly rather than crash if data is stranger than
        // expected.
        console.warn(`  ! ${current.id} (${current.name}) has parent_id=${current.parent_id} which didn't resolve — investigate manually.`);
        break;
      }
      current = parent;
    }
  }

  console.log(`Found ${cyclesBySignature.size} distinct cycle(s):\n`);
  let i = 1;
  for (const cycle of cyclesBySignature.values()) {
    const names = cycle.map((p) => `${p.id} (${p.name})`);
    names.push(names[0]); // show it closing the loop
    console.log(`Cycle ${i++}: ${names.join(" -> ")}`);
  }

  console.log(
    `\nEach cycle above needs exactly one link broken to fix every place hanging off it — ` +
      `pick the place in the cycle that should actually be a root (or should point at a ` +
      `different real parent) and update its parent there, either through the app's place ` +
      `editor or a one-off UPDATE. Once every cycle is broken, re-run ` +
      `\`npm run backfill:place-paths\` and every place should get a path.`
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
