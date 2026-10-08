import { formatDuration } from "@/lib/viz/format";

// Write-time limits on logged durations (#588). A 30h Backgammon session
// (almost certainly 30 minutes) went in because nothing checked more than
// "is it a number".
//
// Pure and free of database imports on purpose, so the server validators
// in `src/lib/days.ts` and the entry forms run the very same rules: the
// forms catch a bad value before submit, and the server stays the
// authority.
//
// Every one of these domains saves replace-on-save: the form sends the
// day's *whole* list for its domain and the server deletes and re-inserts
// it (see `saveGameSessions` and its siblings). So the payload already is
// the day's total for that domain, and the per-day check needs no database
// read. One consequence: an older row that breaks these rules (logged
// before they existed) has to be fixed before anything else in its domain
// can be saved for that day. The error names the value, which is the point:
// that's the row #13's scan is looking for too.

/** A day's minutes. The one cap for every duration rule here, and for #13's
 * data-inconsistency scan when it lands. */
export const MAX_DAILY_MINUTES = 24 * 60;

/** Each domain whose rows carry a `durationMinutes`. Sleep is deliberately
 * absent: it's derived from wake and sleep times and wraps midnight. */
export type DurationDomain = "workouts" | "entertainment" | "movies" | "tv" | "sports" | "books" | "games";

const LABELS: Record<DurationDomain, { one: string; many: string }> = {
  workouts: { one: "A workout", many: "Workouts" },
  entertainment: { one: "An entertainment entry", many: "Other entertainment entries" },
  movies: { one: "A movie watch", many: "Movie watches" },
  tv: { one: "An episode watch", many: "Episode watches" },
  sports: { one: "A sports watch", many: "Sports watches" },
  books: { one: "A reading session", many: "Reading sessions" },
  games: { one: "A game session", many: "Game sessions" },
};

const MAX_LABEL = formatDuration(MAX_DAILY_MINUTES / 60);

/** `minutes` as "30h", "45m", "2h 5m" — or the raw number where that
 * would hide what's wrong with it (a fraction, a negative). */
function describe(minutes: number): string {
  return Number.isInteger(minutes) && minutes >= 0 ? formatDuration(minutes / 60) : `${minutes} minutes`;
}

/** Each entry's own duration: a whole number of minutes, more than 0 and
 * at most a day. `null` (no duration given) is left to the caller, whose
 * own "required" rule differs by domain. */
export function checkEntryDurations(domain: DurationDomain, minutes: readonly (number | null)[]): string | null {
  for (const m of minutes) {
    if (m === null) continue;
    if (!Number.isInteger(m) || m <= 0 || m > MAX_DAILY_MINUTES) {
      return `${LABELS[domain].one} can't last ${describe(m)}: durations must be whole minutes, more than 0 and at most ${MAX_LABEL}.`;
    }
  }
  return null;
}

/** The domain's total for the day can't exceed a day. */
export function checkDayTotal(domain: DurationDomain, totalMinutes: number): string | null {
  if (totalMinutes <= MAX_DAILY_MINUTES) return null;
  return `${LABELS[domain].many} on this day add up to ${describe(Math.round(totalMinutes))}, more than the ${MAX_LABEL} in a day.`;
}

/** Both checks, for a domain whose entries carry their duration directly
 * (everything but workouts). */
export function checkDomainDurations(domain: DurationDomain, minutes: readonly (number | null)[]): string | null {
  return checkEntryDurations(domain, minutes) ?? checkDayTotal(domain, sumMinutes(minutes));
}

function sumMinutes(minutes: readonly (number | null)[]): number {
  return minutes.reduce<number>((sum, m) => sum + (m ?? 0), 0);
}

type WorkoutLike = { durationMinutes: number | null; sets: readonly { durationSeconds: number | null }[] };

/** A workout's minutes. Its own `durationMinutes` when set (distance,
 * sport, and Hevy-imported strength). Otherwise a strength workout's time
 * lives on its sets, in seconds (see `exerciseCategoryEnum` in schema.ts). */
export function workoutMinutes(w: WorkoutLike): number {
  if (w.durationMinutes !== null) return w.durationMinutes;
  return w.sets.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0) / 60;
}

/** Workouts' version of `checkDomainDurations`: the whole-minute rule
 * applies to the `durationMinutes` field, and the day total counts set
 * time too. */
export function checkWorkoutDurations(workouts: readonly WorkoutLike[]): string | null {
  return (
    checkEntryDurations("workouts", workouts.map((w) => w.durationMinutes)) ??
    checkDayTotal("workouts", workouts.reduce((sum, w) => sum + workoutMinutes(w), 0))
  );
}

type DurationRows = readonly { durationMinutes: number | null }[];

/** A day's duration-carrying rows, keyed as `DayPayload` names them, so a
 * loaded day passes straight in (or a form's live rows in their place). */
export type DayDurations = {
  workouts: readonly WorkoutLike[];
  entertainment: DurationRows;
  movies: DurationRows;
  tvEpisodeWatches: DurationRows;
  sportsWatches: DurationRows;
  bookSessions: DurationRows;
  gameSessions: DurationRows;
};

/** Everything logged on one day, across every domain. */
export function dayTotalMinutes(day: DayDurations): number {
  const rows = (list: DurationRows) => sumMinutes(list.map((r) => r.durationMinutes));
  return (
    day.workouts.reduce((sum, w) => sum + workoutMinutes(w), 0) +
    rows(day.entertainment) +
    rows(day.movies) +
    rows(day.tvEpisodeWatches) +
    rows(day.sportsWatches) +
    rows(day.bookSessions) +
    rows(day.gameSessions)
  );
}

/**
 * The cross-domain warning, or null under a day. A warning and never a
 * block (decided on #588): domains legitimately overlap, a game running
 * while a show plays, so a day's total across all of them can honestly
 * pass 24h. It's shown so a slip still gets noticed.
 */
export function crossDomainWarning(totalMinutes: number): string | null {
  if (totalMinutes <= MAX_DAILY_MINUTES) return null;
  return `Everything logged on this day adds up to ${describe(Math.round(totalMinutes))}, more than ${MAX_LABEL}. That still saves, since things can overlap (a game running while a show plays), but check nothing was mistyped.`;
}
