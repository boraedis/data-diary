// The project's own version history (#454), drawn as a timeline on
// /about-project.
//
// A typed constant in the repo rather than a DB table, per #12's split:
// projectSettings holds short facts that might change without a deploy,
// while rarely changing long-form content belongs in the repo where it's
// reviewed like any other copy change. A new version is a new row here,
// which ships with the code that makes that version exist anyway.
//
// Dates are "YYYY-MM-DD" strings like every other date in this app (see
// src/lib/date.ts). A version's end is the next one's start, since each
// replaced the last outright. They never overlapped, so they are written
// back-to-back instead of each carrying its own end date that could drift.

export type ProjectVersion = {
  id: string;
  name: string;
  start: string;
  description: string;
  /** True when `start` is a best guess rather than a recorded date. The
   * page prints these as "c. <year>" instead of a precise month, so a
   * placeholder date isn't presented as fact. */
  approximateStart?: boolean;
};

export const PROJECT_VERSIONS: ProjectVersion[] = [
  {
    id: "numbers",
    name: "Numbers file",
    // The first day in the `days` table.
    start: "2016-02-18",
    description: "One row per day in an Apple Numbers spreadsheet — where the diary began.",
  },
  {
    id: "cli",
    name: "CLI",
    // No record of the exact switch from the spreadsheet survives, so this
    // is left approximate (decided on #454) until a real date turns up.
    start: "2019-01-01",
    approximateStart: true,
    description: "A command-line tool for logging each day from the terminal instead of a spreadsheet.",
  },
  {
    id: "firebase",
    name: "Firebase web app",
    // The legacy repo's "Reboot" commit, when day entry first worked. The
    // repo's initial commit (2022-07-20) was an abandoned start.
    start: "2023-01-18",
    description: "An Express/EJS site on Firebase, backed by Firestore — the first version in a browser.",
  },
  {
    id: "nextjs",
    name: "Next.js + Postgres",
    // This repo's first commit.
    start: "2026-08-22",
    description: "This site: a from-scratch rebuild on Next.js and Postgres.",
  },
];

/** A version's end: the next version's start, or `null` for the current one. */
export function projectVersionEnd(index: number): string | null {
  return PROJECT_VERSIONS[index + 1]?.start ?? null;
}
