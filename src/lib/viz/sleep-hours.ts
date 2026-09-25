// Pure layout helpers for the Sleep Hours chart (#212) — one bar per night
// from falling asleep to waking, against a clock-time axis. Same split as
// timeline.ts/hierarchy.ts: the arithmetic lives here where it can be
// tested, the drawing lives in sleep-hours-chart.tsx.

/**
 * Where the clock axis starts: noon, running to noon the next day.
 *
 * On a midnight-origin axis a 23:00 bedtime and a 01:00 bedtime sit at
 * opposite ends of the chart despite being two hours apart, and every
 * night that crosses midnight — most of them — would have to either wrap
 * off the bottom and back in at the top, or be drawn as two pieces. Noon
 * is the point of the day furthest from any normal night, so on a
 * noon-origin axis an ordinary night is one unbroken bar in the middle,
 * and a late bedtime is simply a bar that starts lower.
 *
 * Measured against the real history before picking it: bedtimes run from
 * about 21:00 to 05:00 and wake times from about 06:00 to 13:00, with only
 * a handful of rows anywhere near noon. A row that does start before noon
 * (a daytime sleep logged as the night) lands at the top rather than
 * wrapping; one that runs past the following noon extends the axis past
 * 24h rather than wrapping (see `fitClockDomain` for how a long range
 * keeps those few from dictating the axis).
 */
export const CLOCK_ORIGIN_MINUTES = 12 * 60;

const DAY_MINUTES = 24 * 60;

/** Clock minutes past midnight (0-1439) → minutes past the axis origin. */
export function toAxisMinutes(clockMinutes: number): number {
  return (((clockMinutes - CLOCK_ORIGIN_MINUTES) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

/** Minutes past the axis origin → "HH:MM" on a 24-hour clock, the format
 * sleep times are entered and stored in. Values past 24h (a night running
 * beyond the next noon) wrap back onto the clock face. */
export function formatAxisClock(axisMinutes: number): string {
  const clock = (((Math.round(axisMinutes) + CLOCK_ORIGIN_MINUTES) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const h = Math.floor(clock / 60);
  const m = clock % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type SleepBar = {
  /** The row's own date — the evening the night began, since a night that
   * crosses midnight is logged against the day you went to bed. */
  date: string;
  /** Minutes past the axis origin that sleep began. */
  start: number;
  /** Minutes past the axis origin that sleep ended — `start` plus the
   * night's duration, never re-derived from the stored wake time. */
  end: number;
  durationMinutes: number;
};

/**
 * One bar per night. The end is `start + durationMinutes` on purpose:
 * `getSleepNightsData` already owns the across-midnight derivation (the
 * `wakeCrossedMidnight` flag and its bad-data guard), and re-deriving it
 * here from the wake time would be a second copy to keep correct.
 */
export function buildSleepBars(nights: { date: string; bedtimeMinutes: number; durationMinutes: number }[]): SleepBar[] {
  return nights.map((n) => {
    const start = toAxisMinutes(n.bedtimeMinutes);
    return { date: n.date, start, end: start + n.durationMinutes, durationMinutes: n.durationMinutes };
  });
}

/** The span a normal night occupies, used when there's nothing to fit to
 * (an empty range) so the axis still reads as a night: 22:00 to 10:00. */
const EMPTY_DOMAIN: [number, number] = [10 * 60, 22 * 60];

/** Never narrower than this, so a range of very regular nights doesn't
 * zoom the axis in until an hour's difference looks like a cliff. */
const MIN_SPAN_MINUTES = 8 * 60;

/** See `fitClockDomain`: how many nights a range needs before the fit
 * trims its extremes, and how much it trims from each end. */
const ROBUST_FIT_MIN_BARS = 200;
const TRIM_FRACTION = 0.005;

/**
 * The y domain for the bars in view: their earliest start to latest end,
 * widened out to whole hours so the axis ticks land on the hour, and to at
 * least `MIN_SPAN_MINUTES`.
 *
 * Fitted to the visible nights rather than fixed at noon-to-noon: a fixed
 * 24h axis spends half its height on the afternoon, where almost nothing
 * ever happens, and squashes the part of the night that actually varies.
 * The cost is that the axis rescales as the range changes — acceptable
 * because the tick labels are clock times, not magnitudes, so nothing is
 * misread as "longer" when the scale moves.
 *
 * Over a long range the fit is to the 0.5th-99.5th percentile rather than
 * the true extremes. The full history has a handful of rows that aren't a
 * night at all — a daytime sleep starting near noon, a near-20h entry —
 * and fitting to those stretched the axis to 33 hours, squeezing every
 * ordinary night into the middle third of the chart. Those few bars are
 * clamped at the plot's edge instead (the chart does that, not this) and
 * keep their true times in the tooltip. Below `ROBUST_FIT_MIN_BARS` every
 * night counts, since trimming a short range would cut a real one off.
 */
export function fitClockDomain(bars: SleepBar[]): [number, number] {
  if (bars.length === 0) return EMPTY_DOMAIN;
  let lo = Infinity;
  let hi = -Infinity;
  if (bars.length >= ROBUST_FIT_MIN_BARS) {
    const starts = bars.map((b) => b.start).sort((a, b) => a - b);
    const ends = bars.map((b) => b.end).sort((a, b) => a - b);
    lo = starts[Math.floor(TRIM_FRACTION * (starts.length - 1))];
    hi = ends[Math.ceil((1 - TRIM_FRACTION) * (ends.length - 1))];
  } else {
    for (const b of bars) {
      if (b.start < lo) lo = b.start;
      if (b.end > hi) hi = b.end;
    }
  }
  lo = Math.floor(lo / 60) * 60;
  hi = Math.ceil(hi / 60) * 60;
  const short = MIN_SPAN_MINUTES - (hi - lo);
  if (short > 0) {
    // Grow evenly on both sides, in whole hours, without pushing above the
    // origin (there's nothing earlier than noon on this axis to show).
    const before = Math.min(lo, Math.floor(short / 2 / 60) * 60);
    lo -= before;
    hi += short - before;
  }
  return [lo, hi];
}

/**
 * Hour-aligned tick values across `domain`, at the smallest whole-hour
 * step that keeps them at least `minGapPx` apart on a `heightPx`-tall
 * axis.
 */
export function clockTicks(domain: [number, number], heightPx: number, minGapPx = 28): number[] {
  const span = domain[1] - domain[0];
  if (span <= 0 || heightPx <= 0) return [];
  const steps = [60, 120, 180, 240, 360];
  const step = steps.find((s) => (s / span) * heightPx >= minGapPx) ?? steps[steps.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(domain[0] / step) * step; t <= domain[1]; t += step) ticks.push(t);
  return ticks;
}
