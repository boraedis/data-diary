// Public-safe reads for the external landing page (#12/#82). Every
// function here is an explicit include-list — it selects only the exact
// columns meant for anonymous visitors and returns a purpose-built shape,
// never a passthrough of profile.ts's own query results. If a new field
// gets added to profile.ts, it does NOT appear here until someone
// deliberately adds it below.
//
// Excluded by design, permanently: profileSettings.birthdate (only the
// derived %-of-life-logged stat is public, not the raw birthdate), the
// relationship timeline (profileRelationships isn't even imported here),
// residences' exact place name/address/lat/lng (metro/region name only),
// all "subs" scores, and anything from the `days` table beyond the two
// aggregate numbers computed below.
import { asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  days,
  metros,
  places,
  profileOccupationRoles,
  profileOccupations,
  profileResidences,
  profileSettings,
} from "@/db/schema";
import { parseDate, toDateString } from "@/lib/date";
import { getProjectSettings, type ProjectSettingsItem } from "@/lib/project";

export type PublicOccupationRole = {
  position: string;
  start: string;
  end: string | null;
};

export type PublicOccupation = {
  position: string | null;
  company: string | null;
  placeName: string | null;
  start: string;
  end: string | null;
  roles: PublicOccupationRole[];
};

export type PublicResidence = {
  region: string | null; // metro name only — never the exact place, address, or lat/lng
  start: string;
  end: string | null;
};

export type PublicStats = {
  daysLogged: number;
  percentOfLifeLogged: number | null;
  daysSinceLastLog: number | null;
};

export type PublicLandingData = {
  project: ProjectSettingsItem;
  ownerName: string | null;
  diaryStartDate: string | null;
  stats: PublicStats;
  occupations: PublicOccupation[];
  residences: PublicResidence[];
};

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((parseDate(toDateStr).getTime() - parseDate(fromDateStr).getTime()) / msPerDay);
}

// Same "has anything meaningful been logged" criteria as
// getHomeDashboardData in src/lib/home.ts, kept independent here rather
// than imported — this module's whole point is a narrow, self-contained
// read path that doesn't inherit whatever an internal query happens to
// select.
const HAS_LOG_DATA = or(
  isNotNull(days.happiness),
  isNotNull(days.sleepTime),
  isNotNull(days.distanceWalkedKm),
  isNotNull(days.productivity),
  isNotNull(days.positivePerson1Id)
);

async function getPublicStats(birthdate: string | null): Promise<PublicStats> {
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)`, lastDate: sql<string | null>`max(${days.date})` })
    .from(days)
    .where(HAS_LOG_DATA);

  const daysLogged = Number(row?.n ?? 0);
  const lastDate = row?.lastDate ?? null;
  const today = toDateString(new Date());
  const daysSinceLastLog = lastDate ? daysBetween(lastDate, today) : null;

  let percentOfLifeLogged: number | null = null;
  if (birthdate) {
    const daysSinceBirth = daysBetween(birthdate, today);
    if (daysSinceBirth > 0) {
      percentOfLifeLogged = (daysLogged / daysSinceBirth) * 100;
    }
  }

  return { daysLogged, percentOfLifeLogged, daysSinceLastLog };
}

// Most-recent-first, matching listProfileOccupations' own ordering — the
// current/most recent entry is what a visitor cares about first.
async function getPublicOccupations(): Promise<PublicOccupation[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: profileOccupations.id,
      position: profileOccupations.position,
      company: profileOccupations.company,
      placeName: places.name,
      start: profileOccupations.start,
      end: profileOccupations.end,
    })
    .from(profileOccupations)
    .leftJoin(places, eq(profileOccupations.placeId, places.id))
    .orderBy(profileOccupations.start);

  if (rows.length === 0) return [];

  const roleRows = await db
    .select({
      occupationId: profileOccupationRoles.occupationId,
      position: profileOccupationRoles.position,
      start: profileOccupationRoles.start,
      end: profileOccupationRoles.end,
    })
    .from(profileOccupationRoles)
    .where(
      inArray(
        profileOccupationRoles.occupationId,
        rows.map((r) => r.id)
      )
    )
    .orderBy(asc(profileOccupationRoles.start));

  const rolesByOccupation = new Map<number, PublicOccupationRole[]>();
  for (const role of roleRows) {
    const list = rolesByOccupation.get(role.occupationId) ?? [];
    list.push({ position: role.position, start: role.start, end: role.end });
    rolesByOccupation.set(role.occupationId, list);
  }

  return rows
    .map((r) => ({
      position: r.position,
      company: r.company,
      placeName: r.placeName,
      start: r.start,
      end: r.end,
      roles: rolesByOccupation.get(r.id) ?? [],
    }))
    .reverse();
}

// Deliberately never selects places.name/address/lat/lng — only the
// linked metro's name, which is null (and rendered as such) when a
// residence's place has no metro assigned rather than falling back to
// any place-level detail.
async function getPublicResidences(): Promise<PublicResidence[]> {
  const db = getDb();
  const rows = await db
    .select({
      region: metros.name,
      start: profileResidences.start,
      end: profileResidences.end,
    })
    .from(profileResidences)
    .innerJoin(places, eq(profileResidences.placeId, places.id))
    .leftJoin(metros, eq(places.metroId, metros.id))
    .orderBy(profileResidences.start);

  return rows.reverse();
}

export async function getPublicLandingData(): Promise<PublicLandingData> {
  const db = getDb();
  const [settingsRow] = await db
    .select({
      name: profileSettings.name,
      birthdate: profileSettings.birthdate,
      diaryStartDate: profileSettings.diaryStartDate,
    })
    .from(profileSettings)
    .where(eq(profileSettings.id, 1));

  const [project, stats, occupations, residences] = await Promise.all([
    getProjectSettings(),
    getPublicStats(settingsRow?.birthdate ?? null),
    getPublicOccupations(),
    getPublicResidences(),
  ]);

  return {
    project,
    ownerName: settingsRow?.name ?? null,
    diaryStartDate: settingsRow?.diaryStartDate ?? null,
    stats,
    occupations,
    residences,
  };
}
