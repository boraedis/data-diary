import { daysBetween, toDateString } from "@/lib/date";

// How far the newest listen is behind today, banded for the manage page
// (issue #643). Spotify's GDPR export is requested by hand and can take up to
// three weeks to arrive, and it's usually a few days behind the request date.
// So the newest listen is a fair proxy for "when did I last pull this",
// and a loose monthly cadence is what the bands are sized around: under 30
// days is fine, 30–59 is due, 60+ is overdue.
export type ImportFreshness = "fresh" | "due" | "overdue";

export function importFreshness(daysSince: number): ImportFreshness {
  if (daysSince < 30) return "fresh";
  if (daysSince < 60) return "due";
  return "overdue";
}

/** Whole days from the newest listen to `today` (a "YYYY-MM-DD" string), or
 * null when nothing has been imported yet. `latestPlayedAt` is an ISO
 * timestamp, so its calendar date is taken in the same timezone as `today`
 * (the server's, on the manage page) to keep both sides on one calendar. */
export function daysSinceLatestListen(latestPlayedAt: string | null, today: string): number | null {
  if (!latestPlayedAt) return null;
  return daysBetween(toDateString(new Date(latestPlayedAt)), today);
}
