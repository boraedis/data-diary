import { getWorkLeaderboardDays } from "@/lib/charts";
import { listProfileOccupations, type ProfileOccupationItem } from "@/lib/profile";
import { rankCreditedSessions, type Credit, type CreditedSession } from "@/lib/leaderboards/sessions";
import type { LeaderboardColumns, LeaderboardRow } from "@/lib/leaderboards/rows";
import type { LeaderboardOption } from "@/lib/leaderboards/options";
import {
  COMMUTE_LABELS,
  commuteCategories,
  WORK_LOCATION_LABELS,
  type WorkDay,
} from "@/lib/work";

// The job leaderboard (#444): days (or hours) worked, ranked by job,
// company, role, work location or commute.
//
// Days don't record which job they were for — only that they were a work
// day — so a day is credited to whichever occupations were active on its
// date in the profile's occupation history. That's what makes the
// days-worked measure reach back years: `dayType = "work"` does, even
// though hours and productivity only start in May 2026.

export type WorkMode = "job" | "company" | "role" | "location" | "commute";

export const WORK_MODES: LeaderboardOption<WorkMode>[] = [
  { id: "job", label: "Jobs" },
  { id: "company", label: "Companies" },
  { id: "role", label: "Roles" },
  { id: "location", label: "Locations" },
  { id: "commute", label: "Commute" },
];

export type WorkLeaderboardMeasure = "days" | "hours";

export const WORK_MEASURES: LeaderboardOption<WorkLeaderboardMeasure>[] = [
  { id: "days", label: "Days worked" },
  { id: "hours", label: "Hours worked" },
];

/** The slice of an occupation this module reads — a structural subset of
 * `ProfileOccupationItem`, so tests can build one without a place. */
export type Occupation = Pick<
  ProfileOccupationItem,
  "id" | "name" | "alias" | "company" | "position" | "start" | "end" | "color"
> & { roles: { position: string; start: string; end: string | null }[] };

function isActive(occ: Occupation, date: string): boolean {
  return occ.start <= date && (occ.end === null || date <= occ.end);
}

/**
 * The role an occupation held on `date`, following `chainRoles`' rule in
 * life-timeline.ts: roles record a start and usually no end, so a role
 * runs until the next one begins. A role with a real `end` before `date`
 * no longer applies. Falls back to the occupation's own `position` when no
 * role covers the date (none recorded, or a gap).
 */
export function roleOn(occ: Occupation, date: string): string | null {
  const sorted = [...occ.roles].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  let held: string | null = null;
  for (const role of sorted) {
    if (role.start > date) break;
    held = role.end !== null && role.end < date ? null : role.position;
  }
  return held ?? occ.position;
}

function yearSpan(occ: Occupation): string {
  const from = occ.start.slice(0, 4);
  const to = occ.end ? occ.end.slice(0, 4) : "now";
  return from === to ? from : `${from}–${to}`;
}

function creditsFor(day: WorkDay, mode: WorkMode, occupations: Occupation[]): Credit[] {
  switch (mode) {
    case "location":
      return day.locations.map((l) => ({ key: l, name: WORK_LOCATION_LABELS[l] }));
    case "commute":
      return commuteCategories(day).map((c) => ({ key: c, name: COMMUTE_LABELS[c] }));
  }
  const active = occupations.filter((o) => isActive(o, day.date));
  switch (mode) {
    // Per occupation *entry*, not per name: two stints at the same place
    // (the two Delta co-ops) are two rows, told apart by their years.
    // Company mode is where stints merge.
    case "job":
      return active.map((o) => ({
        key: String(o.id),
        name: o.alias ?? o.name,
        detail: yearSpan(o),
        context: o.company,
        color: o.color,
      }));
    case "company":
      return active.map((o) => ({ key: o.company ?? o.name, name: o.company ?? o.name, color: o.color }));
    case "role":
      return active.flatMap((o) => {
        const role = roleOn(o, day.date);
        if (!role) return [];
        const company = o.company ?? o.name;
        // Keyed with the company: "Consultant" at CapTech in two cities is
        // one role, but "Consultant" somewhere else is a different one.
        return [{ key: `${company}\u0000${role}`, name: role, detail: company, color: o.color }];
      });
  }
}

/**
 * Ranks days or hours worked under one mode.
 *
 * A day that credits several keys — overlapping jobs, or a morning at home
 * and an afternoon in the office — is treated differently per measure:
 *
 * - **Days**: each key counts the day. It *was* a day worked at home and a
 *   day worked at the office; rows are "days involving X", and their sum
 *   can exceed the number of days worked.
 * - **Hours**: the day's hours are split evenly across its keys, so rows
 *   still sum to the real hours worked. The split is an assumption — the
 *   log doesn't say how the day divided — but crediting every key in full
 *   would invent hours that never happened.
 *
 * Days measure reads `dayType = "work"` (or, for location/commute, any day
 * with one logged); hours measure reads the hours log.
 */
export function buildWorkLeaderboard(
  days: WorkDay[],
  occupations: Occupation[],
  mode: WorkMode,
  measure: WorkLeaderboardMeasure,
): LeaderboardRow[] {
  const sessions: CreditedSession[] = [];
  for (const day of days) {
    if (measure === "hours" && day.minutes === null) continue;
    if (measure === "days" && mode !== "location" && mode !== "commute" && day.dayType !== "work") continue;
    const credits = creditsFor(day, mode, occupations);
    if (credits.length === 0) continue;
    const share = measure === "hours" ? (day.minutes as number) / 60 / credits.length : 1;
    // One session per credit so each can carry its own share.
    for (const credit of credits) sessions.push({ date: day.date, hours: share, credits: [credit] });
  }
  return rankCreditedSessions(sessions);
}

const MODE_NAME_HEADERS: Record<WorkMode, string> = {
  job: "Job",
  company: "Company",
  role: "Role",
  location: "Location",
  commute: "Commute",
};

export function workColumns(mode: WorkMode, measure: WorkLeaderboardMeasure): LeaderboardColumns {
  const context = mode === "job" ? { contextHeader: "Company" } : {};
  if (measure === "hours") {
    return {
      nameHeader: MODE_NAME_HEADERS[mode],
      ...context,
      valueHeader: "Hours",
      valueDescription: "Hours worked. A day credited to more than one row is split evenly between them.",
      valueFormat: "hours",
      countHeader: "Days",
      countDescription: "Days with hours logged.",
      gainedNoun: "hours gained",
    };
  }
  return {
    nameHeader: MODE_NAME_HEADERS[mode],
    ...context,
    valueHeader: "Days",
    valueDescription:
      mode === "location" || mode === "commute"
        ? "Days this was logged. A day with several counts toward each."
        : "Work days while this was active. Where two overlapped, the day counts toward both.",
    valueFormat: "days",
    gainedNoun: "days gained",
  };
}

export async function getWorkLeaderboardData(
  mode: WorkMode,
  measure: WorkLeaderboardMeasure,
): Promise<LeaderboardRow[]> {
  const [days, occupations] = await Promise.all([getWorkLeaderboardDays(), listProfileOccupations()]);
  return buildWorkLeaderboard(days, occupations, mode, measure);
}
