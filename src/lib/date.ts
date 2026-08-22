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

function toDateString(dt: Date): string {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
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
