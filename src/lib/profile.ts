// Admin CRUD for the "profile" domain — see #11: owner identity (name,
// birthdate, diary start date) plus the three profile timelines
// (occupation, residence, relationship) the legacy app kept in a single
// `searchs/profile` Firestore doc as three arrays. Kept separate from
// src/lib/days.ts and src/lib/catalog-admin.ts for the same reason
// catalog-admin.ts already gives for its own split: this is its own
// self-contained domain, not one more thing bolted onto an already-huge
// file. Every function here follows the same "validate -> query -> return"
// shape established in those two files.
import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  people,
  places,
  profileOccupationRoles,
  profileOccupations,
  profileRelationships,
  profileResidences,
  profileSettings,
} from "@/db/schema";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// --- Owner identity ----------------------------------------------------
// Single-row settings — see the `profileSettings` table comment in
// schema.ts for why this is a table with one pinned row (id = 1) rather
// than a real multi-row catalog. Timezone is deliberately not part of this
// — cut from #11's scope in the issue thread.

export type ProfileSettingsItem = {
  name: string | null;
  birthdate: string | null;
  diaryStartDate: string | null;
};

export function validateProfileSettingsInput(body: unknown): Result<ProfileSettingsItem> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : null;
  const birthdate = typeof b.birthdate === "string" && b.birthdate.trim() ? b.birthdate.trim() : null;
  const diaryStartDate =
    typeof b.diaryStartDate === "string" && b.diaryStartDate.trim() ? b.diaryStartDate.trim() : null;
  return { ok: true, value: { name, birthdate, diaryStartDate } };
}

// Row id=1 either exists (from a prior save) or doesn't yet — every field
// defaults to null rather than the route needing to special-case "no
// settings saved yet" as an error.
export async function getProfileSettings(): Promise<ProfileSettingsItem> {
  const db = getDb();
  const [row] = await db
    .select({
      name: profileSettings.name,
      birthdate: profileSettings.birthdate,
      diaryStartDate: profileSettings.diaryStartDate,
    })
    .from(profileSettings)
    .where(eq(profileSettings.id, 1));
  return row ?? { name: null, birthdate: null, diaryStartDate: null };
}

export async function upsertProfileSettings(input: ProfileSettingsItem): Promise<ProfileSettingsItem> {
  const db = getDb();
  const [row] = await db
    .insert(profileSettings)
    .values({ id: 1, ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: profileSettings.id,
      set: { ...input, updatedAt: new Date() },
    })
    .returning({
      name: profileSettings.name,
      birthdate: profileSettings.birthdate,
      diaryStartDate: profileSettings.diaryStartDate,
    });
  return row;
}

// --- Shared timeline-entry validation -----------------------------------
// start/end validation is identical across all three timeline types — one
// helper instead of three copies.

type TimelineDates = { start: string; end: string | null };

function validateTimelineDates(b: Record<string, unknown>): Result<TimelineDates> {
  const start = typeof b.start === "string" ? b.start.trim() : "";
  if (!start) return { ok: false, error: "Start date is required" };
  const end = typeof b.end === "string" && b.end.trim() ? b.end.trim() : null;
  if (end && end < start) return { ok: false, error: "End date can't be before start date" };
  return { ok: true, value: { start, end } };
}

// --- Occupation ----------------------------------------------------------
// Legacy shape: {position, company, place, name, start, end?, alias?,
// color?, roles?}. `roles` is managed through its own set of functions
// below (addProfileOccupationRole etc.), not through create/update here —
// mirrors how exercise focus links are added/removed independently of the
// exercise they're attached to.

export type ProfileOccupationRole = {
  id: number;
  occupationId: number;
  position: string;
  start: string;
  end: string | null;
};

export type ProfileOccupationItem = {
  id: number;
  name: string;
  position: string | null;
  company: string | null;
  placeId: number | null;
  placeName: string | null;
  start: string;
  end: string | null;
  alias: string | null;
  color: string | null;
  roles: ProfileOccupationRole[];
};

export type ProfileOccupationInput = {
  name: string;
  position: string | null;
  company: string | null;
  placeId: number | null;
  start: string;
  end: string | null;
  alias: string | null;
  color: string | null;
};

export function validateProfileOccupationInput(body: unknown): Result<ProfileOccupationInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };

  const dates = validateTimelineDates(b);
  if (!dates.ok) return dates;

  let placeId: number | null = null;
  if (b.placeId !== null && b.placeId !== undefined) {
    if (typeof b.placeId !== "number" || !Number.isInteger(b.placeId)) {
      return { ok: false, error: "Invalid placeId" };
    }
    placeId = b.placeId;
  }

  return {
    ok: true,
    value: {
      name,
      position: typeof b.position === "string" && b.position.trim() ? b.position.trim() : null,
      company: typeof b.company === "string" && b.company.trim() ? b.company.trim() : null,
      placeId,
      start: dates.value.start,
      end: dates.value.end,
      alias: typeof b.alias === "string" && b.alias.trim() ? b.alias.trim() : null,
      color: typeof b.color === "string" && b.color.trim() ? b.color.trim() : null,
    },
  };
}

const OCCUPATION_COLUMNS = {
  id: profileOccupations.id,
  name: profileOccupations.name,
  position: profileOccupations.position,
  company: profileOccupations.company,
  placeId: profileOccupations.placeId,
  start: profileOccupations.start,
  end: profileOccupations.end,
  alias: profileOccupations.alias,
  color: profileOccupations.color,
};

function selectOccupationsWithPlace() {
  const db = getDb();
  return db
    .select({ ...OCCUPATION_COLUMNS, placeName: places.name })
    .from(profileOccupations)
    .leftJoin(places, eq(profileOccupations.placeId, places.id));
}

async function attachOccupationRoles<T extends { id: number }>(
  rows: T[]
): Promise<(T & { roles: ProfileOccupationRole[] })[]> {
  if (rows.length === 0) return [];
  const db = getDb();
  const roleRows = await db
    .select()
    .from(profileOccupationRoles)
    .where(
      inArray(
        profileOccupationRoles.occupationId,
        rows.map((r) => r.id)
      )
    )
    .orderBy(asc(profileOccupationRoles.start));
  const byOccupation = new Map<number, ProfileOccupationRole[]>();
  for (const role of roleRows) {
    const list = byOccupation.get(role.occupationId) ?? [];
    list.push(role);
    byOccupation.set(role.occupationId, list);
  }
  return rows.map((r) => ({ ...r, roles: byOccupation.get(r.id) ?? [] }));
}

// Ordered most-recent-first (nulls — "ongoing" — sort first) since that's
// the order the generic editor's list and preview chart both want: current
// occupation/residence/relationship at the top, not buried under a decade
// of history. Achieved by sorting on `start` desc — an ongoing entry's
// start date is still its most recent event even without an end date.
export async function listProfileOccupations(): Promise<ProfileOccupationItem[]> {
  const rows = await selectOccupationsWithPlace().orderBy(profileOccupations.start);
  const withRoles = await attachOccupationRoles(rows);
  return withRoles.reverse();
}

export async function createProfileOccupation(input: ProfileOccupationInput): Promise<ProfileOccupationItem> {
  const db = getDb();
  const [inserted] = await db.insert(profileOccupations).values(input).returning({ id: profileOccupations.id });
  const item = await getProfileOccupation(inserted.id);
  return item as ProfileOccupationItem; // just inserted — always exists
}

export async function getProfileOccupation(id: number): Promise<ProfileOccupationItem | null> {
  const [row] = await selectOccupationsWithPlace().where(eq(profileOccupations.id, id));
  if (!row) return null;
  const [withRoles] = await attachOccupationRoles([row]);
  return withRoles;
}

export async function updateProfileOccupation(
  id: number,
  input: ProfileOccupationInput
): Promise<ProfileOccupationItem> {
  const db = getDb();
  await db.update(profileOccupations).set(input).where(eq(profileOccupations.id, id));
  const item = await getProfileOccupation(id);
  return item as ProfileOccupationItem;
}

// No usage check needed before delete — nothing else in the schema
// references a profile_occupations row (unlike people/places/tags, which
// gate real day-entry data). Roles cascade automatically.
export async function deleteProfileOccupation(id: number): Promise<void> {
  const db = getDb();
  await db.delete(profileOccupations).where(eq(profileOccupations.id, id));
}

export type ProfileOccupationRoleInput = { position: string; start: string; end: string | null };

export function validateProfileOccupationRoleInput(body: unknown): Result<ProfileOccupationRoleInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const position = typeof b.position === "string" ? b.position.trim() : "";
  if (!position) return { ok: false, error: "Position is required" };
  const dates = validateTimelineDates(b);
  if (!dates.ok) return dates;
  return { ok: true, value: { position, start: dates.value.start, end: dates.value.end } };
}

export async function addProfileOccupationRole(
  occupationId: number,
  input: ProfileOccupationRoleInput
): Promise<ProfileOccupationRole> {
  const db = getDb();
  const [inserted] = await db
    .insert(profileOccupationRoles)
    .values({ occupationId, ...input })
    .returning();
  return inserted;
}

export async function getProfileOccupationRole(id: number): Promise<ProfileOccupationRole | null> {
  const db = getDb();
  const [row] = await db.select().from(profileOccupationRoles).where(eq(profileOccupationRoles.id, id));
  return row ?? null;
}

export async function updateProfileOccupationRole(
  id: number,
  input: ProfileOccupationRoleInput
): Promise<ProfileOccupationRole> {
  const db = getDb();
  const [updated] = await db
    .update(profileOccupationRoles)
    .set(input)
    .where(eq(profileOccupationRoles.id, id))
    .returning();
  return updated;
}

export async function deleteProfileOccupationRole(id: number): Promise<void> {
  const db = getDb();
  await db.delete(profileOccupationRoles).where(eq(profileOccupationRoles.id, id));
}

// --- Residence -------------------------------------------------------------
// Legacy shape: {place, name, start, end?, alias?, color?}. Unlike
// occupation, `placeId` is required — a residence without a place isn't
// really a residence entry (see the `profileResidences` table comment).

export type ProfileResidenceItem = {
  id: number;
  name: string;
  placeId: number;
  placeName: string;
  start: string;
  end: string | null;
  alias: string | null;
  color: string | null;
};

export type ProfileResidenceInput = {
  name: string;
  placeId: number;
  start: string;
  end: string | null;
  alias: string | null;
  color: string | null;
};

export function validateProfileResidenceInput(body: unknown): Result<ProfileResidenceInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  if (typeof b.placeId !== "number" || !Number.isInteger(b.placeId)) {
    return { ok: false, error: "Place is required" };
  }
  const dates = validateTimelineDates(b);
  if (!dates.ok) return dates;
  return {
    ok: true,
    value: {
      name,
      placeId: b.placeId,
      start: dates.value.start,
      end: dates.value.end,
      alias: typeof b.alias === "string" && b.alias.trim() ? b.alias.trim() : null,
      color: typeof b.color === "string" && b.color.trim() ? b.color.trim() : null,
    },
  };
}

const RESIDENCE_COLUMNS = {
  id: profileResidences.id,
  name: profileResidences.name,
  placeId: profileResidences.placeId,
  start: profileResidences.start,
  end: profileResidences.end,
  alias: profileResidences.alias,
  color: profileResidences.color,
};

function selectResidencesWithPlace() {
  const db = getDb();
  return db
    .select({ ...RESIDENCE_COLUMNS, placeName: places.name })
    .from(profileResidences)
    .innerJoin(places, eq(profileResidences.placeId, places.id));
}

export async function listProfileResidences(): Promise<ProfileResidenceItem[]> {
  const rows = await selectResidencesWithPlace().orderBy(profileResidences.start);
  return rows.reverse();
}

export async function createProfileResidence(input: ProfileResidenceInput): Promise<ProfileResidenceItem> {
  const db = getDb();
  const [inserted] = await db.insert(profileResidences).values(input).returning({ id: profileResidences.id });
  const item = await getProfileResidence(inserted.id);
  return item as ProfileResidenceItem;
}

export async function getProfileResidence(id: number): Promise<ProfileResidenceItem | null> {
  const [row] = await selectResidencesWithPlace().where(eq(profileResidences.id, id));
  return row ?? null;
}

export async function updateProfileResidence(
  id: number,
  input: ProfileResidenceInput
): Promise<ProfileResidenceItem> {
  const db = getDb();
  await db.update(profileResidences).set(input).where(eq(profileResidences.id, id));
  const item = await getProfileResidence(id);
  return item as ProfileResidenceItem;
}

export async function deleteProfileResidence(id: number): Promise<void> {
  const db = getDb();
  await db.delete(profileResidences).where(eq(profileResidences.id, id));
}

// --- Relationship ----------------------------------------------------------
// Legacy shape: {id (person), name, start, end?, alias?, color?} — no
// status/type field, just a person and a date range. Never offered as a
// chart region-shading source and has no dedicated timeline chart in
// legacy — profile-display-only, per the issue thread.

export type ProfileRelationshipItem = {
  id: number;
  name: string;
  personId: number;
  personName: string;
  start: string;
  end: string | null;
  alias: string | null;
  color: string | null;
};

export type ProfileRelationshipInput = {
  name: string;
  personId: number;
  start: string;
  end: string | null;
  alias: string | null;
  color: string | null;
};

export function validateProfileRelationshipInput(body: unknown): Result<ProfileRelationshipInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  if (typeof b.personId !== "number" || !Number.isInteger(b.personId)) {
    return { ok: false, error: "Person is required" };
  }
  const dates = validateTimelineDates(b);
  if (!dates.ok) return dates;
  return {
    ok: true,
    value: {
      name,
      personId: b.personId,
      start: dates.value.start,
      end: dates.value.end,
      alias: typeof b.alias === "string" && b.alias.trim() ? b.alias.trim() : null,
      color: typeof b.color === "string" && b.color.trim() ? b.color.trim() : null,
    },
  };
}

const RELATIONSHIP_COLUMNS = {
  id: profileRelationships.id,
  name: profileRelationships.name,
  personId: profileRelationships.personId,
  start: profileRelationships.start,
  end: profileRelationships.end,
  alias: profileRelationships.alias,
  color: profileRelationships.color,
};

function selectRelationshipsWithPerson() {
  const db = getDb();
  return db
    .select({ ...RELATIONSHIP_COLUMNS, personName: people.name })
    .from(profileRelationships)
    .innerJoin(people, eq(profileRelationships.personId, people.id));
}

export async function listProfileRelationships(): Promise<ProfileRelationshipItem[]> {
  const rows = await selectRelationshipsWithPerson().orderBy(profileRelationships.start);
  return rows.reverse();
}

export async function createProfileRelationship(
  input: ProfileRelationshipInput
): Promise<ProfileRelationshipItem> {
  const db = getDb();
  const [inserted] = await db
    .insert(profileRelationships)
    .values(input)
    .returning({ id: profileRelationships.id });
  const item = await getProfileRelationship(inserted.id);
  return item as ProfileRelationshipItem;
}

export async function getProfileRelationship(id: number): Promise<ProfileRelationshipItem | null> {
  const [row] = await selectRelationshipsWithPerson().where(eq(profileRelationships.id, id));
  return row ?? null;
}

export async function updateProfileRelationship(
  id: number,
  input: ProfileRelationshipInput
): Promise<ProfileRelationshipItem> {
  const db = getDb();
  await db.update(profileRelationships).set(input).where(eq(profileRelationships.id, id));
  const item = await getProfileRelationship(id);
  return item as ProfileRelationshipItem;
}

export async function deleteProfileRelationship(id: number): Promise<void> {
  const db = getDb();
  await db.delete(profileRelationships).where(eq(profileRelationships.id, id));
}
