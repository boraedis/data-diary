// Admin CRUD for the smaller reference catalogs that back the richer
// people/places/exercises fields added alongside the legacy "database tab"
// research (REBUILD_PLAN.md's "Legacy backend parity" note): tags, exercise
// subtypes/focuses, and place categories/subcategories/metros. Kept
// separate from src/lib/days.ts (which already owns the people/places/
// exercises catalog CRUD these reference) purely to keep that file from
// growing without bound — every function here follows the exact same
// "upsert-by-unique-key on create, get/update/delete + usage check" shape
// established there.
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { parseOptionalHexColor } from "@/lib/color";
import {
  days,
  entertainmentCatalog,
  entertainmentKinds,
  exerciseFocusLinks,
  exerciseFocuses,
  exerciseSubfocuses,
  exerciseSubtypes,
  metros,
  people,
  placeCategories,
  places,
  placeSubcategories,
  tags,
  type ExerciseCategory,
} from "@/db/schema";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// --- Tags --------------------------------------------------------------
// See the `tags` table comment in schema.ts: a real catalog now (name +
// color), with `people.tagId` as a proper FK — renaming/recoloring a tag
// is a single UPDATE here, no member-cascade needed the way legacy's
// name-denormalized-onto-every-person-doc design required.

export type TagCatalogItem = { id: number; name: string; color: string | null };

const TAG_COLUMNS = { id: tags.id, name: tags.name, color: tags.color };

export function validateTagInput(body: unknown): Result<{ name: string; color: string | null }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  const color = parseOptionalHexColor(b.color);
  if (!color.ok) return { ok: false, error: "Color must be in format #xxxxxx" };
  return { ok: true, value: { name, color: color.value } };
}

// Member counts via a left join + count/group-by — legacy computed this by
// scanning every person's tag string client-side each time the tags list
// rendered; a real DB does the aggregate instead.
export async function listTags(): Promise<(TagCatalogItem & { memberCount: number })[]> {
  const db = getDb();
  return db
    .select({ ...TAG_COLUMNS, memberCount: count(people.id) })
    .from(tags)
    .leftJoin(people, eq(people.tagId, tags.id))
    .groupBy(tags.id, tags.name, tags.color)
    .orderBy(asc(tags.name));
}

// No onConflictDoNothing-and-reselect upsert here, unlike every other
// catalog's create function — legacy's create-tag silently overwrote an
// existing tag's color on a duplicate name (a real bug, confirmed while
// researching this), which this deliberately does NOT reproduce. A
// duplicate name should fail loudly (the DB's unique constraint throws;
// the API route translates that into a 409), not silently clobber.
export async function createTag(input: { name: string; color: string | null }): Promise<TagCatalogItem> {
  const db = getDb();
  const [inserted] = await db
    .insert(tags)
    .values({ name: input.name.trim(), color: input.color })
    .returning(TAG_COLUMNS);
  return inserted;
}

export async function getTag(id: number): Promise<TagCatalogItem | null> {
  const db = getDb();
  const [row] = await db.select(TAG_COLUMNS).from(tags).where(eq(tags.id, id));
  return row ?? null;
}

export async function updateTag(id: number, input: { name: string; color: string | null }): Promise<TagCatalogItem> {
  const db = getDb();
  const [updated] = await db
    .update(tags)
    .set({ name: input.name.trim(), color: input.color })
    .where(eq(tags.id, id))
    .returning(TAG_COLUMNS);
  return updated;
}

export type TagUsage = { members: { id: number; name: string }[] };

// people.tagId is onDelete: "restrict" — the DB itself would refuse the
// delete too; this is the "show everyone tagged X" view legacy's tag.js
// had, doubling as the usage check.
export async function getTagUsage(id: number): Promise<TagUsage> {
  const db = getDb();
  const rows = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.tagId, id))
    .orderBy(asc(people.name));
  return { members: rows };
}

export async function deleteTag(id: number): Promise<void> {
  const db = getDb();
  await db.delete(tags).where(eq(tags.id, id));
}

// --- Entertainment kinds -------------------------------------------------
// See the `entertainmentKinds` table comment in schema.ts. System rows
// (Movie/TV show/Sport/Book/Game) are seeded once and can't be created,
// renamed, or deleted here — everything below is scoped to the
// user-added "neutral" kinds.

export type EntertainmentKindItem = { id: number; name: string; isSystem: boolean };

const ENTERTAINMENT_KIND_COLUMNS = {
  id: entertainmentKinds.id,
  name: entertainmentKinds.name,
  isSystem: entertainmentKinds.isSystem,
};

export function validateEntertainmentKindInput(body: unknown): Result<{ name: string }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  return { ok: true, value: { name } };
}

// System kinds first (in their seeded id order — Movie/TV show/Sport/Book/
// Game), then custom kinds alphabetically.
export async function listEntertainmentKinds(): Promise<EntertainmentKindItem[]> {
  const db = getDb();
  return db
    .select(ENTERTAINMENT_KIND_COLUMNS)
    .from(entertainmentKinds)
    .orderBy(desc(entertainmentKinds.isSystem), asc(entertainmentKinds.id), asc(entertainmentKinds.name));
}

// Always a custom kind — there's no flow that creates a new system kind
// after the one-time seed (see scripts/migrate-entertainment-kinds.mjs).
export async function createEntertainmentKindEntry(name: string): Promise<EntertainmentKindItem> {
  const db = getDb();
  const [inserted] = await db
    .insert(entertainmentKinds)
    .values({ name: name.trim(), isSystem: false })
    .returning(ENTERTAINMENT_KIND_COLUMNS);
  return inserted;
}

export type EntertainmentKindUsage = { catalogCount: number };

export async function getEntertainmentKindUsage(id: number): Promise<EntertainmentKindUsage> {
  const db = getDb();
  const rows = await db
    .select({ id: entertainmentCatalog.id })
    .from(entertainmentCatalog)
    .where(eq(entertainmentCatalog.kindId, id));
  return { catalogCount: rows.length };
}

// entertainmentCatalog.kindId is onDelete: "restrict", so the DB would
// refuse this anyway once anything's catalogued under it — the isSystem
// check here just gives a clearer error than a raw FK violation for the
// case that's actually reachable through the UI (there's no "delete kind"
// button next to a system row, but the API route itself only calls this
// for a custom kind's own detail page, so this is defense in depth, not
// the primary guard).
export async function deleteEntertainmentKindEntry(id: number): Promise<void> {
  const db = getDb();
  const [row] = await db.select({ isSystem: entertainmentKinds.isSystem }).from(entertainmentKinds).where(eq(entertainmentKinds.id, id));
  if (row?.isSystem) {
    throw new Error("Movie/TV show/Sport/Book/Game are built in and can't be deleted.");
  }
  await db.delete(entertainmentKinds).where(eq(entertainmentKinds.id, id));
}

// Ported from the legacy app's functions/views/entry/database/tag.js
// (loadRecommendedMembers): people who aren't tagged X but frequently show
// up on the same day as people who are — a nudge toward "you keep logging
// this person alongside your X people, maybe they belong here too" (or,
// when they already carry a different tag, just an interesting overlap).
//
// For every day, count how many of that day's (up to 10) people slots are
// filled by a member of this tag. Every *other* person present that day
// gets that count added to a running score, and +1 to a running
// appearance count — across every day, not just days a member showed up,
// same as legacy. The final ranking score is score / sqrt(appearances):
// dividing by the square root (not the raw count) rewards people who
// consistently co-occur with a lot of this tag's members without letting
// one big day, or one lonely appearance, dominate the ranking the way a
// straight average or a straight total would.
export type RecommendedTagMember = {
  id: number;
  name: string;
  score: number;
  tagName: string | null;
  tagColor: string | null;
};

export async function getRecommendedTagMembers(tagId: number, limit = 25): Promise<RecommendedTagMember[]> {
  const db = getDb();

  const memberRows = await db.select({ id: people.id }).from(people).where(eq(people.tagId, tagId));
  const memberIds = new Set(memberRows.map((r) => r.id));
  if (memberIds.size === 0) return [];

  const dayRows = await db
    .select({
      p1: days.positivePerson1Id,
      p2: days.positivePerson2Id,
      p3: days.positivePerson3Id,
      p4: days.positivePerson4Id,
      p5: days.positivePerson5Id,
      p6: days.positivePerson6Id,
      p7: days.positivePerson7Id,
      n1: days.negativePerson1Id,
      n2: days.negativePerson2Id,
      n3: days.negativePerson3Id,
    })
    .from(days);

  const tally = new Map<number, { score: number; appearances: number }>();
  for (const row of dayRows) {
    const ids = [row.p1, row.p2, row.p3, row.p4, row.p5, row.p6, row.p7, row.n1, row.n2, row.n3].filter(
      (id): id is number => id !== null,
    );
    const unique = [...new Set(ids)];
    const memberCountThisDay = unique.filter((id) => memberIds.has(id)).length;
    for (const id of unique) {
      if (memberIds.has(id)) continue;
      const entry = tally.get(id) ?? { score: 0, appearances: 0 };
      entry.score += memberCountThisDay;
      entry.appearances += 1;
      tally.set(id, entry);
    }
  }

  const ranked = [...tally.entries()]
    .map(([id, { score, appearances }]) => ({
      id,
      value: Math.round((score / Math.sqrt(appearances)) * 100) / 100,
    }))
    .filter((r) => r.value > 1)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
  if (ranked.length === 0) return [];

  const candidateRows = await db
    .select({ id: people.id, name: people.name, tagName: tags.name, tagColor: tags.color })
    .from(people)
    .leftJoin(tags, eq(people.tagId, tags.id))
    .where(
      inArray(
        people.id,
        ranked.map((r) => r.id),
      ),
    );
  const byId = new Map(candidateRows.map((r) => [r.id, r]));

  return ranked.map((r) => {
    const p = byId.get(r.id);
    return { id: r.id, name: p?.name ?? "?", score: r.value, tagName: p?.tagName ?? null, tagColor: p?.tagColor ?? null };
  });
}

// --- Exercise subtypes (catalog, scoped per category) ----------------------

export type ExerciseSubtypeItem = { id: number; category: ExerciseCategory; name: string };

export function validateExerciseSubtypeInput(body: unknown): Result<{ category: ExerciseCategory; name: string }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  const validCategories = new Set<string>(["distance", "sport", "strength"] satisfies ExerciseCategory[]);
  if (typeof b.category !== "string" || !validCategories.has(b.category)) {
    return { ok: false, error: "Invalid category" };
  }
  return { ok: true, value: { category: b.category as ExerciseCategory, name } };
}

export async function listExerciseSubtypes(category?: ExerciseCategory): Promise<ExerciseSubtypeItem[]> {
  const db = getDb();
  if (category) {
    return db.select().from(exerciseSubtypes).where(eq(exerciseSubtypes.category, category)).orderBy(asc(exerciseSubtypes.name));
  }
  return db.select().from(exerciseSubtypes).orderBy(asc(exerciseSubtypes.category), asc(exerciseSubtypes.name));
}

export async function createExerciseSubtype(input: { category: ExerciseCategory; name: string }): Promise<ExerciseSubtypeItem> {
  const db = getDb();
  const trimmed = input.name.trim();
  const [inserted] = await db
    .insert(exerciseSubtypes)
    .values({ category: input.category, name: trimmed })
    .onConflictDoNothing({ target: [exerciseSubtypes.category, exerciseSubtypes.name] })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(exerciseSubtypes)
    .where(and(eq(exerciseSubtypes.category, input.category), eq(exerciseSubtypes.name, trimmed)));
  return existing;
}

export async function getExerciseSubtype(id: number): Promise<ExerciseSubtypeItem | null> {
  const db = getDb();
  const [row] = await db.select().from(exerciseSubtypes).where(eq(exerciseSubtypes.id, id));
  return row ?? null;
}

export async function updateExerciseSubtype(
  id: number,
  input: { category: ExerciseCategory; name: string }
): Promise<ExerciseSubtypeItem> {
  const db = getDb();
  const [updated] = await db
    .update(exerciseSubtypes)
    .set({ category: input.category, name: input.name.trim() })
    .where(eq(exerciseSubtypes.id, id))
    .returning();
  return updated;
}

// No usage check — workouts.subtype is (deliberately) free text, not an FK
// into this catalog, so removing a subtype here can't orphan a reference.
export async function deleteExerciseSubtype(id: number): Promise<void> {
  const db = getDb();
  await db.delete(exerciseSubtypes).where(eq(exerciseSubtypes.id, id));
}

// --- Exercise focus / subfocus (catalog + many-to-many tagging) -----------

export type ExerciseFocusItem = { id: number; name: string };
export type ExerciseSubfocusItem = { id: number; focusId: number; name: string };

export function validateNameInput(body: unknown): Result<{ name: string }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  return { ok: true, value: { name } };
}

export async function listExerciseFocuses(): Promise<(ExerciseFocusItem & { subfocuses: ExerciseSubfocusItem[] })[]> {
  const db = getDb();
  const [focusRows, subfocusRows] = await Promise.all([
    db.select().from(exerciseFocuses).orderBy(asc(exerciseFocuses.name)),
    db.select().from(exerciseSubfocuses).orderBy(asc(exerciseSubfocuses.name)),
  ]);
  const byFocus = new Map<number, ExerciseSubfocusItem[]>();
  for (const s of subfocusRows) {
    const list = byFocus.get(s.focusId) ?? [];
    list.push(s);
    byFocus.set(s.focusId, list);
  }
  return focusRows.map((f) => ({ ...f, subfocuses: byFocus.get(f.id) ?? [] }));
}

export async function createExerciseFocus(name: string): Promise<ExerciseFocusItem> {
  const db = getDb();
  const trimmed = name.trim();
  const [inserted] = await db
    .insert(exerciseFocuses)
    .values({ name: trimmed })
    .onConflictDoNothing({ target: exerciseFocuses.name })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(exerciseFocuses).where(eq(exerciseFocuses.name, trimmed));
  return existing;
}

export async function createExerciseSubfocus(focusId: number, name: string): Promise<ExerciseSubfocusItem> {
  const db = getDb();
  const trimmed = name.trim();
  const [inserted] = await db
    .insert(exerciseSubfocuses)
    .values({ focusId, name: trimmed })
    .onConflictDoNothing({ target: [exerciseSubfocuses.focusId, exerciseSubfocuses.name] })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(exerciseSubfocuses)
    .where(and(eq(exerciseSubfocuses.focusId, focusId), eq(exerciseSubfocuses.name, trimmed)));
  return existing;
}

export async function getExerciseFocus(id: number): Promise<ExerciseFocusItem | null> {
  const db = getDb();
  const [row] = await db.select().from(exerciseFocuses).where(eq(exerciseFocuses.id, id));
  return row ?? null;
}

export async function updateExerciseFocus(id: number, name: string): Promise<ExerciseFocusItem> {
  const db = getDb();
  const [updated] = await db
    .update(exerciseFocuses)
    .set({ name: name.trim() })
    .where(eq(exerciseFocuses.id, id))
    .returning();
  return updated;
}

// Both subfocusCount and linkCount are real DB-level blocks — exerciseSubfocuses.focusId
// and exerciseFocusLinks.focusId are both onDelete: "restrict" — so the DB
// would refuse this delete on its own if either exists; surfaced here so
// the caller can explain why before hitting that error.
export type ExerciseFocusUsage = { subfocusCount: number; linkCount: number };

export async function getExerciseFocusUsage(id: number): Promise<ExerciseFocusUsage> {
  const db = getDb();
  const [subfocusRows, linkRows] = await Promise.all([
    db.select({ id: exerciseSubfocuses.id }).from(exerciseSubfocuses).where(eq(exerciseSubfocuses.focusId, id)),
    db.select({ id: exerciseFocusLinks.id }).from(exerciseFocusLinks).where(eq(exerciseFocusLinks.focusId, id)),
  ]);
  return { subfocusCount: subfocusRows.length, linkCount: linkRows.length };
}

export async function deleteExerciseFocus(id: number): Promise<void> {
  const db = getDb();
  await db.delete(exerciseFocuses).where(eq(exerciseFocuses.id, id));
}

export function validateExerciseSubfocusInput(body: unknown): Result<{ focusId: number; name: string }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  if (typeof b.focusId !== "number" || !Number.isInteger(b.focusId)) {
    return { ok: false, error: "Invalid focusId" };
  }
  return { ok: true, value: { focusId: b.focusId, name } };
}

export async function getExerciseSubfocus(id: number): Promise<ExerciseSubfocusItem | null> {
  const db = getDb();
  const [row] = await db.select().from(exerciseSubfocuses).where(eq(exerciseSubfocuses.id, id));
  return row ?? null;
}

export async function updateExerciseSubfocus(
  id: number,
  input: { focusId: number; name: string }
): Promise<ExerciseSubfocusItem> {
  const db = getDb();
  const [updated] = await db
    .update(exerciseSubfocuses)
    .set({ focusId: input.focusId, name: input.name.trim() })
    .where(eq(exerciseSubfocuses.id, id))
    .returning();
  return updated;
}

// exerciseFocusLinks.subfocusId is onDelete: "restrict" — a real DB-level
// block, surfaced here the same way as everywhere else.
export type ExerciseSubfocusUsage = { linkCount: number };

export async function getExerciseSubfocusUsage(id: number): Promise<ExerciseSubfocusUsage> {
  const db = getDb();
  const rows = await db.select({ id: exerciseFocusLinks.id }).from(exerciseFocusLinks).where(eq(exerciseFocusLinks.subfocusId, id));
  return { linkCount: rows.length };
}

export async function deleteExerciseSubfocus(id: number): Promise<void> {
  const db = getDb();
  await db.delete(exerciseSubfocuses).where(eq(exerciseSubfocuses.id, id));
}

export type ExerciseFocusLink = {
  id: number;
  exerciseId: number;
  focusId: number;
  subfocusId: number | null;
  label: string | null;
  focusName: string;
  subfocusName: string | null;
};

export function validateExerciseFocusLinkInput(
  body: unknown
): Result<{ focusId: number; subfocusId: number | null; label: string | null }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.focusId !== "number" || !Number.isInteger(b.focusId)) {
    return { ok: false, error: "Invalid focusId" };
  }
  let subfocusId: number | null = null;
  if (b.subfocusId !== null && b.subfocusId !== undefined) {
    if (typeof b.subfocusId !== "number" || !Number.isInteger(b.subfocusId)) {
      return { ok: false, error: "Invalid subfocusId" };
    }
    subfocusId = b.subfocusId;
  }
  const label = typeof b.label === "string" && b.label.trim() ? b.label.trim() : null;
  return { ok: true, value: { focusId: b.focusId, subfocusId, label } };
}

// An exercise can carry more than one focus/subfocus pair (legacy stored
// this as an array on the exercise doc) — this is the join table backing
// that, listed with names resolved so a caller doesn't need a second
// round-trip against the focus/subfocus catalogs just to render it.
export async function listExerciseFocusLinks(exerciseId: number): Promise<ExerciseFocusLink[]> {
  const db = getDb();
  return db
    .select({
      id: exerciseFocusLinks.id,
      exerciseId: exerciseFocusLinks.exerciseId,
      focusId: exerciseFocusLinks.focusId,
      subfocusId: exerciseFocusLinks.subfocusId,
      label: exerciseFocusLinks.label,
      focusName: exerciseFocuses.name,
      subfocusName: exerciseSubfocuses.name,
    })
    .from(exerciseFocusLinks)
    .innerJoin(exerciseFocuses, eq(exerciseFocusLinks.focusId, exerciseFocuses.id))
    .leftJoin(exerciseSubfocuses, eq(exerciseFocusLinks.subfocusId, exerciseSubfocuses.id))
    .where(eq(exerciseFocusLinks.exerciseId, exerciseId))
    .orderBy(asc(exerciseFocuses.name));
}

export async function addExerciseFocusLink(
  exerciseId: number,
  input: { focusId: number; subfocusId: number | null; label: string | null }
): Promise<{ id: number }> {
  const db = getDb();
  const [inserted] = await db
    .insert(exerciseFocusLinks)
    .values({ exerciseId, focusId: input.focusId, subfocusId: input.subfocusId, label: input.label })
    .returning({ id: exerciseFocusLinks.id });
  return inserted;
}

export async function removeExerciseFocusLink(linkId: number): Promise<void> {
  const db = getDb();
  await db.delete(exerciseFocusLinks).where(eq(exerciseFocusLinks.id, linkId));
}

// --- Place categories / subcategories / metros ------------------------------
// See the `placeCategories`/`placeSubcategories`/`metros` table comments in
// schema.ts — these are the maintained catalogs a place picker reads from;
// `places.category`/`places.subcategory` themselves stay plain free-text
// strings (matching how legacy actually stored them on a place doc), so
// there's no FK here to validate against on the places side.

export type PlaceCategoryItem = { id: number; name: string };
export type PlaceSubcategoryItem = { id: number; categoryId: number; name: string };

export async function listPlaceCategories(): Promise<(PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[]> {
  const db = getDb();
  const [catRows, subRows] = await Promise.all([
    db.select().from(placeCategories).orderBy(asc(placeCategories.name)),
    db.select().from(placeSubcategories).orderBy(asc(placeSubcategories.name)),
  ]);
  const byCategory = new Map<number, PlaceSubcategoryItem[]>();
  for (const s of subRows) {
    const list = byCategory.get(s.categoryId) ?? [];
    list.push(s);
    byCategory.set(s.categoryId, list);
  }
  return catRows.map((c) => ({ ...c, subcategories: byCategory.get(c.id) ?? [] }));
}

export async function createPlaceCategory(name: string): Promise<PlaceCategoryItem> {
  const db = getDb();
  const trimmed = name.trim();
  const [inserted] = await db
    .insert(placeCategories)
    .values({ name: trimmed })
    .onConflictDoNothing({ target: placeCategories.name })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(placeCategories).where(eq(placeCategories.name, trimmed));
  return existing;
}

export async function getPlaceCategory(id: number): Promise<PlaceCategoryItem | null> {
  const db = getDb();
  const [row] = await db.select().from(placeCategories).where(eq(placeCategories.id, id));
  return row ?? null;
}

export async function updatePlaceCategory(id: number, name: string): Promise<PlaceCategoryItem> {
  const db = getDb();
  const [updated] = await db
    .update(placeCategories)
    .set({ name: name.trim() })
    .where(eq(placeCategories.id, id))
    .returning();
  return updated;
}

// places.category is a plain free-text string (see the `places` table
// comment in schema.ts — matches how legacy stored it too), not an FK, so
// nothing at the DB level stops deleting a category still referenced by a
// place's `category` string. This checks that soft reference at the app
// level instead, same "block if still used" spirit as every FK-backed
// usage check elsewhere. `subcategoryCount` doubles as a real DB guard too
// — placeSubcategories.categoryId is onDelete: "restrict", so the DB would
// refuse this delete on its own if subcategories exist; checking it here
// just lets the caller explain why before hitting that error.
export type PlaceCategoryUsage = { placeCount: number; subcategoryCount: number };

export async function getPlaceCategoryUsage(id: number): Promise<PlaceCategoryUsage> {
  const db = getDb();
  const category = await getPlaceCategory(id);
  if (!category) return { placeCount: 0, subcategoryCount: 0 };
  const [placeRows, subcategoryRows] = await Promise.all([
    db.select({ id: places.id }).from(places).where(eq(places.category, category.name)),
    db.select({ id: placeSubcategories.id }).from(placeSubcategories).where(eq(placeSubcategories.categoryId, id)),
  ]);
  return { placeCount: placeRows.length, subcategoryCount: subcategoryRows.length };
}

export async function deletePlaceCategory(id: number): Promise<void> {
  const db = getDb();
  await db.delete(placeCategories).where(eq(placeCategories.id, id));
}

export async function createPlaceSubcategory(categoryId: number, name: string): Promise<PlaceSubcategoryItem> {
  const db = getDb();
  const trimmed = name.trim();
  const [inserted] = await db
    .insert(placeSubcategories)
    .values({ categoryId, name: trimmed })
    .onConflictDoNothing({ target: [placeSubcategories.categoryId, placeSubcategories.name] })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(placeSubcategories)
    .where(and(eq(placeSubcategories.categoryId, categoryId), eq(placeSubcategories.name, trimmed)));
  return existing;
}

export async function getPlaceSubcategory(id: number): Promise<PlaceSubcategoryItem | null> {
  const db = getDb();
  const [row] = await db.select().from(placeSubcategories).where(eq(placeSubcategories.id, id));
  return row ?? null;
}

export async function updatePlaceSubcategory(id: number, name: string): Promise<PlaceSubcategoryItem> {
  const db = getDb();
  const [updated] = await db
    .update(placeSubcategories)
    .set({ name: name.trim() })
    .where(eq(placeSubcategories.id, id))
    .returning();
  return updated;
}

// Same soft-reference reasoning as getPlaceCategoryUsage — places.subcategory
// is free text, not an FK, so this checks the string match by hand.
export type PlaceSubcategoryUsage = { placeCount: number };

export async function getPlaceSubcategoryUsage(id: number): Promise<PlaceSubcategoryUsage> {
  const db = getDb();
  const subcategory = await getPlaceSubcategory(id);
  if (!subcategory) return { placeCount: 0 };
  const rows = await db.select({ id: places.id }).from(places).where(eq(places.subcategory, subcategory.name));
  return { placeCount: rows.length };
}

export async function deletePlaceSubcategory(id: number): Promise<void> {
  const db = getDb();
  await db.delete(placeSubcategories).where(eq(placeSubcategories.id, id));
}

export type MetroItem = { id: number; name: string; country: string | null; alias: string | null };

export function validateMetroInput(body: unknown): Result<{ name: string; country: string | null; alias: string | null }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  const country = typeof b.country === "string" && b.country.trim() ? b.country.trim() : null;
  const alias = typeof b.alias === "string" && b.alias.trim() ? b.alias.trim() : null;
  return { ok: true, value: { name, country, alias } };
}

export async function listMetros(): Promise<MetroItem[]> {
  const db = getDb();
  return db.select().from(metros).orderBy(asc(metros.name));
}

export async function createMetro(input: { name: string; country: string | null; alias: string | null }): Promise<MetroItem> {
  const db = getDb();
  const trimmed = input.name.trim();
  const [inserted] = await db
    .insert(metros)
    .values({ name: trimmed, country: input.country, alias: input.alias })
    .onConflictDoNothing({ target: metros.name })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(metros).where(eq(metros.name, trimmed));
  return existing;
}

export async function getMetro(id: number): Promise<MetroItem | null> {
  const db = getDb();
  const [row] = await db.select().from(metros).where(eq(metros.id, id));
  return row ?? null;
}

export async function updateMetro(
  id: number,
  input: { name: string; country: string | null; alias: string | null }
): Promise<MetroItem> {
  const db = getDb();
  const [updated] = await db
    .update(metros)
    .set({ name: input.name.trim(), country: input.country, alias: input.alias })
    .where(eq(metros.id, id))
    .returning();
  return updated;
}

// places.metroId is onDelete: "set null" (unlike the "restrict" FKs
// elsewhere) — legacy's metro picker was an optional refinement on top of
// the Region/Municipality category special-case, not a hard dependency, so
// losing a metro here just clears the field on any place that had it. This
// is informational only: the caller can warn ("N places will lose their
// metro"), not block.
export type MetroUsage = { placeCount: number };

export async function getMetroUsage(id: number): Promise<MetroUsage> {
  const db = getDb();
  const rows = await db.select({ id: places.id }).from(places).where(eq(places.metroId, id));
  return { placeCount: rows.length };
}

export async function deleteMetro(id: number): Promise<void> {
  const db = getDb();
  await db.delete(metros).where(eq(metros.id, id));
}
