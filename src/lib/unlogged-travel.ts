// Data layer for unlogged travel (#323/#363) — places travelled to or
// through that never made a day's top-two place slots. See the
// `unloggedTravel` schema comment for why it's one table with a `kind`,
// and why both kinds key off a code rather than a name.
//
// Same "validate -> query -> return" shape as every other domain lib here
// (see src/lib/project.ts). Two distinct sets of callers:
//
//   - the maps (#365/#366) want the *codes only*, as a Set, to answer
//     "is this polygon travelled?" per feature during a render;
//   - the manage surface (#367) wants whole rows, and CRUD.
//
// Kept as separate functions rather than one fetch-everything the callers
// pick over: a choropleth asks its question once per polygon across up to
// ~3,200 counties, so handing it a Set it can hit directly matters more
// here than the usual "one query shape is simpler" instinct.
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { unloggedTravel } from "@/db/schema";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type UnloggedTravelKind = "us_county" | "country";

export const UNLOGGED_TRAVEL_KINDS: readonly UnloggedTravelKind[] = ["us_county", "country"] as const;

export type UnloggedTravelItem = {
  kind: UnloggedTravelKind;
  code: string;
  firstVisited: string | null;
  note: string | null;
};

function isKind(value: unknown): value is UnloggedTravelKind {
  return value === "us_county" || value === "country";
}

/**
 * Validates a create/update payload from the manage surface.
 *
 * `code` is only checked for being non-empty here, deliberately — whether
 * "13021" is a real county and "840" a real country is a question for
 * us-atlas and world-atlas, not for this layer, and the picker in #367
 * resolves against those before ever calling this. A shape check that
 * *looked* authoritative ("5 digits for a county") would be worse than
 * none: it would reject the three id-less world-atlas territories whose
 * code is a name, which the schema comment explains are legitimate.
 */
export function validateUnloggedTravelInput(body: unknown): Result<UnloggedTravelItem> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid request body" };
  const b = body as Record<string, unknown>;

  if (!isKind(b.kind)) return { ok: false, error: "kind must be 'us_county' or 'country'" };
  const code = typeof b.code === "string" ? b.code.trim() : "";
  if (!code) return { ok: false, error: "code is required" };

  // A date or nothing. An unparseable string is rejected rather than
  // coerced to null: silently discarding a date someone typed is how a
  // field that exists to answer "when" ends up empty everywhere.
  let firstVisited: string | null = null;
  if (typeof b.firstVisited === "string" && b.firstVisited.trim()) {
    const raw = b.firstVisited.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
      return { ok: false, error: "firstVisited must be a YYYY-MM-DD date" };
    }
    firstVisited = raw;
  }

  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim() : null;
  return { ok: true, value: { kind: b.kind, code, firstVisited, note } };
}

/** Every row of one kind, oldest-known-visit first then by code — a
 * stable order for the manage list, with undated rows last (SQL sorts
 * NULLs last on ASC in Postgres, which is the wanted end for "unknown"). */
export async function listUnloggedTravel(kind: UnloggedTravelKind): Promise<UnloggedTravelItem[]> {
  const db = getDb();
  return db
    .select({
      kind: unloggedTravel.kind,
      code: unloggedTravel.code,
      firstVisited: unloggedTravel.firstVisited,
      note: unloggedTravel.note,
    })
    .from(unloggedTravel)
    .where(eq(unloggedTravel.kind, kind))
    .orderBy(asc(unloggedTravel.firstVisited), asc(unloggedTravel.code));
}

/**
 * Just the codes of one kind, as a Set — what a choropleth needs.
 *
 * A Set rather than an array because the caller's access pattern is one
 * membership test per drawn polygon, and a US county map draws ~3,200 of
 * them per render. `Array.includes` over a few hundred travelled counties
 * would turn that into hundreds of thousands of comparisons per frame-ish
 * rebuild, for no reason.
 */
export async function getUnloggedTravelCodes(kind: UnloggedTravelKind): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ code: unloggedTravel.code })
    .from(unloggedTravel)
    .where(eq(unloggedTravel.kind, kind));
  return new Set(rows.map((r) => r.code));
}

/**
 * Inserts a row, or updates the one already at this (kind, code).
 *
 * Upsert rather than insert, because the composite primary key *is* the
 * identity: re-running the seed, or re-adding a county someone already
 * entered by hand, should be a no-op-or-update rather than a constraint
 * violation. `createdAt` is deliberately left alone on conflict — it
 * records when the place was first written down, which a later edit to
 * its note doesn't change.
 */
export async function upsertUnloggedTravel(item: UnloggedTravelItem): Promise<void> {
  const db = getDb();
  await db
    .insert(unloggedTravel)
    .values(item)
    .onConflictDoUpdate({
      target: [unloggedTravel.kind, unloggedTravel.code],
      set: { firstVisited: item.firstVisited, note: item.note },
    });
}

export async function deleteUnloggedTravel(kind: UnloggedTravelKind, code: string): Promise<void> {
  const db = getDb();
  await db.delete(unloggedTravel).where(and(eq(unloggedTravel.kind, kind), eq(unloggedTravel.code, code)));
}
