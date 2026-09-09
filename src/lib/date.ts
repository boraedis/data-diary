const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed, real calendar date string ("2026-02-29" on a
 * non-leap year is rejected, not silently rolled forward). */
export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const dt = new Date(year, month - 1, day);
  return (
    dt.getFullYear() === year &&
    dt.getMonth() === month - 1 &&
    dt.getDate() === day
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateString(dt: Date): string {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Parses a "YYYY-MM-DD" string into a Date built from its own year/month/
 * day fields — never `new Date(dateStr)`, which parses a bare date as UTC
 * midnight and can print the wrong calendar day in a negative-UTC-offset
 * timezone (see viz/format.ts's formatDate, which follows the same rule).
 * The inverse of toDateString — together they're the round-trip pair every
 * chart that plots real dates on a d3 time scale should use instead of
 * re-deriving this by hand per file (see interactive-line.tsx, #18). */
export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Pure calendar-date arithmetic — no timezone involved, just adding days
 * to a "YYYY-MM-DD" string and letting JS Date handle month/year rollover. */
export function addDays(dateStr: string, delta: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dt = new Date(year, month - 1, day + delta);
  return toDateString(dt);
}

/**
 * Today's calendar date in whatever timezone the caller is running in.
 * There's deliberately no fixed "app timezone" — a day is whatever date you
 * say you're journaling for. Call this from a "use client" component so it
 * reflects the visitor's own local date, not the server's.
 */
export function todayDateString(): string {
  return toDateString(new Date());
}

/**
 * Whole calendar days from `from` to `to` — negative when `to` is earlier.
 *
 * Built from `Date.UTC` on the parsed y/m/d fields rather than from two
 * local `Date`s: a local-midnight subtraction is 23 or 25 hours across a
 * DST boundary, so the naive `(b - a) / 86400000` drifts by a day the
 * moment a range spans one. UTC noon-free arithmetic on bare calendar
 * fields has no such boundary, and these are calendar dates with no time
 * of day to preserve in the first place.
 */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}
