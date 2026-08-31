// Shared, non-visual formatting helpers for the viz toolkit (#16) — pure
// functions every Interactive* primitive and chart page should import
// instead of hand-rolling its own axis-tick/tooltip text, the way each of
// the current 8 chart pages does today. Deliberately no epoch-day math:
// legacy's num2date/date2num ("days since 2000-04-20") was a Firestore-
// document-key workaround that no longer applies now that Postgres stores
// real dates (see project memory rebuild-decisions.md) — every date this
// module touches is a plain "YYYY-MM-DD" string or a native Date built from
// one, per src/lib/date.ts's convention.

// --- Duration ---------------------------------------------------------------

/**
 * Decimal hours -> "2h 15m" (legacy's times2dur/str2dur parsed clock times
 * *into* decimal hours; this is the display-formatting direction back out,
 * which legacy never actually had — every chart that showed a duration
 * hand-rolled its own `Math.round(x * 10) / 10 + 'h'`, e.g.
 * sleep_averager.js). Sub-hour durations drop the "0h" ("45m", not "0h
 * 45m"); a duration that rounds to exactly zero still prints "0m" rather
 * than an empty string, so a chart label is never blank. Negative input
 * (bad data, not a real "duration") clamps to 0 rather than printing a
 * minus sign.
 */
export function formatDuration(hours: number): string {
  const totalMinutes = Math.round(Math.max(hours, 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// --- Date ---------------------------------------------------------------

export type DateFormatPreset = "short" | "month" | "monthYear" | "weekday";

const DATE_FORMAT_OPTIONS: Record<DateFormatPreset, Intl.DateTimeFormatOptions> = {
  short: { month: "short", day: "numeric" }, // "Feb 14" — axis ticks, day-level tooltips
  month: { month: "long" }, // "February" — calendar-view headers
  monthYear: { month: "short", year: "numeric" }, // "Feb 2026" — monthly-bucketed axis ticks
  weekday: { weekday: "short", month: "short", day: "numeric" }, // "Sat, Feb 14" — tooltip headline
};

/**
 * Formats a "YYYY-MM-DD" calendar-date string (as stored throughout this
 * app — see src/lib/date.ts) for chart display. Built from the date's own
 * year/month/day fields via `new Date(y, m - 1, d)`, the same
 * timezone-free construction src/lib/date.ts uses — never `new
 * Date(dateStr)`, which parses a bare "YYYY-MM-DD" as UTC midnight and can
 * print the wrong calendar day in a negative-UTC-offset timezone.
 */
export function formatDate(dateStr: string, preset: DateFormatPreset = "short"): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(undefined, DATE_FORMAT_OPTIONS[preset]);
}

// --- Number ---------------------------------------------------------------

const compactNumberFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Large numbers as "1.2k" / "3.4M" — axis ticks and stat tiles where a
 * bare `12345` is more digits than the reader needs to parse. */
export function formatCompactNumber(value: number): string {
  return compactNumberFormat.format(value);
}

const thousandsNumberFormat = new Intl.NumberFormat(undefined);

/** Full-precision numbers with thousands separators — "12,345" — for
 * tooltips and table views, where (unlike an axis tick) the exact value
 * matters and shouldn't be abbreviated. */
export function formatThousandsNumber(value: number): string {
  return thousandsNumberFormat.format(value);
}

/**
 * `value` is a 0-1 fraction (0.42, not 42) -> "42%", matching how this
 * app's own ratios are computed (e.g. workout-day fraction), not a
 * pre-multiplied percentage. `fractionDigits` controls precision for
 * ratios that need it (0 by default — whole-percent chart labels).
 */
export function formatPercent(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}
