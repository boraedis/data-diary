import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mock-db";
import {
  validateBooksPayload,
  validateEntertainmentPayload,
  validateGamesPayload,
  validateHealthPayload,
  validateMoviesPayload,
  validatePeoplePayload,
  validatePlacesPayload,
  validateSleepPayload,
  validateSportsPayload,
  validateTvEpisodesPayload,
} from "@/lib/days";

// This file covers only the FK-existence, presence, and conditional-
// required rules added for #64 — the rest of days.ts's much larger
// validation surface is out of scope here. See #38's PR thread for why the
// mocked-drizzle-client strategy this file uses hasn't been extended to
// the rest of that file yet.

const dbState = vi.hoisted(() => ({ current: undefined as MockDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => dbState.current }));

describe("validateSleepPayload", () => {
  it("accepts both times present", () => {
    expect(validateSleepPayload({ sleepTime: "23:00", wakeTime: "07:00" }).ok).toBe(true);
  });

  it("accepts neither time present", () => {
    expect(validateSleepPayload({}).ok).toBe(true);
  });

  it("rejects sleepTime without wakeTime", () => {
    expect(validateSleepPayload({ sleepTime: "23:00" })).toEqual({
      ok: false,
      error: "Sleep time and wake time must be entered together",
    });
  });

  it("rejects wakeTime without sleepTime", () => {
    expect(validateSleepPayload({ wakeTime: "07:00" })).toEqual({
      ok: false,
      error: "Sleep time and wake time must be entered together",
    });
  });
});

describe("validateHealthPayload", () => {
  // The exercises lookup returns each row's category as well as its id —
  // one query answers both "does this exist" and "which duration rule
  // applies" (see findExerciseCategories in days.ts). So a queued exercise
  // row needs a real category on it, or the duration rule below is being
  // tested against undefined.
  const strength = (id: number) => ({ id, category: "strength" as const });
  const distance = (id: number) => ({ id, category: "distance" as const });
  const sport = (id: number) => ({ id, category: "sport" as const });

  /** A strength workout that satisfies the duration rule, for tests about
   * something other than duration. */
  const timedSet = { sets: [{ setNumber: 1, reps: 10, durationSeconds: 60 }] };

  it("accepts a workout whose exercise and location both exist", async () => {
    dbState.current = createMockDb([[strength(5)], [{ id: 9 }]]);
    const result = await validateHealthPayload({
      workouts: [{ exerciseId: 5, locationId: 9, ...timedSet }],
    });
    expect(result.ok).toBe(true);
  });

  it("skips the location lookup entirely when no workout has one (no wasted DB call)", async () => {
    dbState.current = createMockDb([[strength(5)]]); // only one queued result — a second DB call would throw
    const result = await validateHealthPayload({ workouts: [{ exerciseId: 5, ...timedSet }] });
    expect(result.ok).toBe(true);
  });

  it("rejects a workout referencing an exercise that doesn't exist", async () => {
    dbState.current = createMockDb([[]]); // exercises lookup finds nothing
    const result = await validateHealthPayload({ workouts: [{ exerciseId: 999 }] });
    expect(result).toEqual({ ok: false, error: "Exercise not found: 999" });
  });

  it("reports a missing exercise before checking anything else about it", async () => {
    // The id isn't in the returned map at all, so there's no category to
    // apply a duration rule with — "not found" has to win, and it has to
    // win before the place lookup runs (one queued result, so a second
    // call would throw).
    dbState.current = createMockDb([[strength(5)]]);
    const result = await validateHealthPayload({
      workouts: [
        { exerciseId: 5, ...timedSet },
        { exerciseId: 999, locationId: 9 },
      ],
    });
    expect(result).toEqual({ ok: false, error: "Exercise not found: 999" });
  });

  it("rejects a workout referencing a location that doesn't exist", async () => {
    dbState.current = createMockDb([[strength(5)], []]);
    const result = await validateHealthPayload({
      workouts: [{ exerciseId: 5, locationId: 999, ...timedSet }],
    });
    expect(result).toEqual({ ok: false, error: "Location not found: 999" });
  });

  it("checks each referenced exercise id only once even if used by multiple workouts", async () => {
    dbState.current = createMockDb([[strength(5)]]); // one queued result for one deduped lookup
    const result = await validateHealthPayload({
      workouts: [
        { exerciseId: 5, ...timedSet },
        { exerciseId: 5, ...timedSet },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("still rejects a malformed workout (missing exerciseId) before any DB lookup", async () => {
    dbState.current = createMockDb([]); // any DB call here would throw
    const result = await validateHealthPayload({ workouts: [{}] });
    expect(result).toEqual({ ok: false, error: "Every workout needs an exercise" });
  });

  // #284's rule: every workout carries a duration somewhere, but *where*
  // depends on the exercise's category — distance and sport have their own
  // scalar minutes, strength has none at all and has to prove it through a
  // set. Shipped untested; these are the tests it should have had (#291).
  const DURATION_ERROR =
    "Duration is required for every workout — distance/sport need a duration, strength needs at least one set with a duration";

  it("rejects a distance workout with no duration", async () => {
    dbState.current = createMockDb([[distance(5)]]);
    const result = await validateHealthPayload({ workouts: [{ exerciseId: 5, distanceKm: 5 }] });
    expect(result).toEqual({ ok: false, error: DURATION_ERROR });
  });

  it("rejects a sport workout with no duration", async () => {
    dbState.current = createMockDb([[sport(5)]]);
    const result = await validateHealthPayload({ workouts: [{ exerciseId: 5 }] });
    expect(result).toEqual({ ok: false, error: DURATION_ERROR });
  });

  it("accepts a distance workout that has one", async () => {
    dbState.current = createMockDb([[distance(5)]]);
    const result = await validateHealthPayload({
      workouts: [{ exerciseId: 5, distanceKm: 5, durationMinutes: 30 }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a strength workout whose sets are all untimed", async () => {
    // Not the same as "no duration field" — a strength workout legitimately
    // has no durationMinutes of its own, so the rule reads its sets.
    dbState.current = createMockDb([[strength(5)]]);
    const result = await validateHealthPayload({
      workouts: [{ exerciseId: 5, sets: [{ setNumber: 1, reps: 10, weightLbs: 135 }] }],
    });
    expect(result).toEqual({ ok: false, error: DURATION_ERROR });
  });

  it("rejects a strength workout with no sets at all", async () => {
    dbState.current = createMockDb([[strength(5)]]);
    const result = await validateHealthPayload({ workouts: [{ exerciseId: 5 }] });
    expect(result).toEqual({ ok: false, error: DURATION_ERROR });
  });

  it("accepts a strength workout where any one set is timed", async () => {
    dbState.current = createMockDb([[strength(5)]]);
    const result = await validateHealthPayload({
      workouts: [
        {
          exerciseId: 5,
          sets: [
            { setNumber: 1, reps: 10, weightLbs: 135 },
            { setNumber: 2, reps: 10, durationSeconds: 45 },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("does not accept a strength workout's own durationMinutes in place of a timed set", async () => {
    // The form has no duration field for strength, so a payload carrying
    // one didn't come from the UI — the rule shouldn't quietly honour it.
    dbState.current = createMockDb([[strength(5)]]);
    const result = await validateHealthPayload({
      workouts: [{ exerciseId: 5, durationMinutes: 45, sets: [{ setNumber: 1, reps: 10 }] }],
    });
    expect(result).toEqual({ ok: false, error: DURATION_ERROR });
  });

  it("rejects the batch when any one workout is missing its duration", async () => {
    dbState.current = createMockDb([[distance(5), strength(6)]]);
    const result = await validateHealthPayload({
      workouts: [
        { exerciseId: 5, durationMinutes: 30 },
        { exerciseId: 6, sets: [{ setNumber: 1, reps: 10 }] },
      ],
    });
    expect(result).toEqual({ ok: false, error: DURATION_ERROR });
  });

  it("checks duration before the location lookup, so a bad batch costs one query", async () => {
    // One queued result: reaching the place lookup would throw.
    dbState.current = createMockDb([[distance(5)]]);
    const result = await validateHealthPayload({
      workouts: [{ exerciseId: 5, locationId: 9 }],
    });
    expect(result).toEqual({ ok: false, error: DURATION_ERROR });
  });
});

describe("validatePeoplePayload", () => {
  it("accepts an entry whose person exists", async () => {
    dbState.current = createMockDb([[{ id: 3 }]]);
    const result = await validatePeoplePayload({ entries: [{ valence: "positive", slot: 0, personId: 3 }] });
    expect(result.ok).toBe(true);
  });

  it("rejects an entry whose person doesn't exist", async () => {
    dbState.current = createMockDb([[]]);
    const result = await validatePeoplePayload({ entries: [{ valence: "positive", slot: 0, personId: 404 }] });
    expect(result).toEqual({ ok: false, error: "Person not found: 404" });
  });

  it("rejects invalid shape before any DB lookup", async () => {
    dbState.current = createMockDb([]); // any DB call here would throw
    const result = await validatePeoplePayload({ entries: [{ valence: "sideways", slot: 0, personId: 1 }] });
    expect(result).toEqual({ ok: false, error: "Invalid valence" });
  });
});

describe("validatePlacesPayload", () => {
  it("accepts an entry whose place exists", async () => {
    dbState.current = createMockDb([[{ id: 7 }]]);
    const result = await validatePlacesPayload({ entries: [{ slot: 0, placeId: 7 }] });
    expect(result.ok).toBe(true);
  });

  it("rejects an entry whose place doesn't exist", async () => {
    dbState.current = createMockDb([[]]);
    const result = await validatePlacesPayload({ entries: [{ slot: 0, placeId: 404 }] });
    expect(result).toEqual({ ok: false, error: "Place not found: 404" });
  });
});

// Every entertainment kind (other/movies/tv/books/games) now requires
// locationType and durationMinutes on each entry — a watch/session with
// neither isn't a meaningful log entry. Sports additionally requires
// league/season/home team, and away team only for team sports (see
// sports-section.tsx's TeamSelect, which never renders an away-team field
// for an individual sport).

describe("validateEntertainmentPayload", () => {
  const base = { entertainmentId: 1, locationType: "Home", durationMinutes: 30 };

  it("accepts an entry with both location and duration", () => {
    expect(validateEntertainmentPayload({ entries: [base] }).ok).toBe(true);
  });

  it("rejects a missing location", () => {
    expect(validateEntertainmentPayload({ entries: [{ ...base, locationType: null }] })).toEqual({
      ok: false,
      error: "Location is required",
    });
  });

  it("rejects a missing duration", () => {
    expect(validateEntertainmentPayload({ entries: [{ ...base, durationMinutes: null }] })).toEqual({
      ok: false,
      error: "Duration is required",
    });
  });
});

describe("validateMoviesPayload", () => {
  const base = { movieId: 1, locationType: "Theater", durationMinutes: 120 };

  it("accepts an entry with both location and duration", () => {
    expect(validateMoviesPayload({ entries: [base] }).ok).toBe(true);
  });

  it("rejects a missing location", () => {
    expect(validateMoviesPayload({ entries: [{ ...base, locationType: null }] })).toEqual({
      ok: false,
      error: "Location is required for a movie watch",
    });
  });

  it("rejects a missing duration", () => {
    expect(validateMoviesPayload({ entries: [{ ...base, durationMinutes: null }] })).toEqual({
      ok: false,
      error: "Duration is required for a movie watch",
    });
  });
});

describe("validateTvEpisodesPayload", () => {
  const base = { episodeId: 1, locationType: "Home", durationMinutes: 22 };

  it("accepts an entry with both location and duration", () => {
    expect(validateTvEpisodesPayload({ entries: [base] }).ok).toBe(true);
  });

  it("rejects a missing location", () => {
    expect(validateTvEpisodesPayload({ entries: [{ ...base, locationType: null }] })).toEqual({
      ok: false,
      error: "Location is required for an episode watch",
    });
  });

  it("rejects a missing duration", () => {
    expect(validateTvEpisodesPayload({ entries: [{ ...base, durationMinutes: null }] })).toEqual({
      ok: false,
      error: "Duration is required for an episode watch",
    });
  });
});

describe("validateBooksPayload", () => {
  const base = { bookId: 1, locationType: "Home", durationMinutes: 45 };

  it("accepts an entry with both location and duration", () => {
    expect(validateBooksPayload({ entries: [base] }).ok).toBe(true);
  });

  it("rejects a missing location", () => {
    expect(validateBooksPayload({ entries: [{ ...base, locationType: null }] })).toEqual({
      ok: false,
      error: "Location is required for a reading session",
    });
  });

  it("rejects a missing duration", () => {
    expect(validateBooksPayload({ entries: [{ ...base, durationMinutes: null }] })).toEqual({
      ok: false,
      error: "Duration is required for a reading session",
    });
  });
});

describe("validateGamesPayload", () => {
  const base = { gameId: 1, locationType: "Home", durationMinutes: 60 };

  it("accepts an entry with both location and duration", () => {
    expect(validateGamesPayload({ entries: [base] }).ok).toBe(true);
  });

  it("rejects a missing location", () => {
    expect(validateGamesPayload({ entries: [{ ...base, locationType: null }] })).toEqual({
      ok: false,
      error: "Location is required for a game session",
    });
  });

  it("rejects a missing duration", () => {
    expect(validateGamesPayload({ entries: [{ ...base, durationMinutes: null }] })).toEqual({
      ok: false,
      error: "Duration is required for a game session",
    });
  });
});

describe("validateSportsPayload", () => {
  const teamSportEntry = {
    sportId: 1,
    leagueId: 10,
    season: "2024-25",
    homeTeamId: 100,
    awayTeamId: 200,
    locationType: "Bar",
    durationMinutes: 180,
  };

  it("accepts a team-sport entry with league/season/both teams/location/duration", async () => {
    dbState.current = createMockDb([[{ id: 1, isTeamSport: true }]]);
    const result = await validateSportsPayload({ entries: [teamSportEntry] });
    expect(result.ok).toBe(true);
  });

  it("rejects a sport id that doesn't exist", async () => {
    dbState.current = createMockDb([[]]);
    const result = await validateSportsPayload({ entries: [teamSportEntry] });
    expect(result).toEqual({ ok: false, error: "Sport not found: 1" });
  });

  it("rejects a team-sport entry missing the away team", async () => {
    dbState.current = createMockDb([[{ id: 1, isTeamSport: true }]]);
    const result = await validateSportsPayload({ entries: [{ ...teamSportEntry, awayTeamId: null }] });
    expect(result).toEqual({ ok: false, error: "Away team is required for a sports watch" });
  });

  it("rejects a missing league", async () => {
    dbState.current = createMockDb([[{ id: 1, isTeamSport: true }]]);
    const result = await validateSportsPayload({ entries: [{ ...teamSportEntry, leagueId: null }] });
    expect(result).toEqual({ ok: false, error: "League is required for a sports watch" });
  });

  it("rejects a missing season", async () => {
    dbState.current = createMockDb([[{ id: 1, isTeamSport: true }]]);
    const result = await validateSportsPayload({ entries: [{ ...teamSportEntry, season: null }] });
    expect(result).toEqual({ ok: false, error: "Season is required for a sports watch" });
  });

  it("does not require an away team for an individual (non-team) sport", async () => {
    dbState.current = createMockDb([[{ id: 2, isTeamSport: false }]]);
    const result = await validateSportsPayload({
      entries: [{ ...teamSportEntry, sportId: 2, awayTeamId: null }],
    });
    expect(result.ok).toBe(true);
  });

  it("still requires the athlete (homeTeamId) for an individual sport", async () => {
    dbState.current = createMockDb([[{ id: 2, isTeamSport: false }]]);
    const result = await validateSportsPayload({
      entries: [{ ...teamSportEntry, sportId: 2, awayTeamId: null, homeTeamId: null }],
    });
    expect(result).toEqual({ ok: false, error: "Athlete is required for a sports watch" });
  });

  it("rejects a missing location", async () => {
    dbState.current = createMockDb([[{ id: 1, isTeamSport: true }]]);
    const result = await validateSportsPayload({ entries: [{ ...teamSportEntry, locationType: null }] });
    expect(result).toEqual({ ok: false, error: "Location is required for a sports watch" });
  });

  it("rejects a missing duration", async () => {
    dbState.current = createMockDb([[{ id: 1, isTeamSport: true }]]);
    const result = await validateSportsPayload({ entries: [{ ...teamSportEntry, durationMinutes: null }] });
    expect(result).toEqual({ ok: false, error: "Duration is required for a sports watch" });
  });

  it("looks up each distinct sport id only once across multiple entries", async () => {
    dbState.current = createMockDb([[{ id: 1, isTeamSport: true }]]); // one queued result for one deduped lookup
    const result = await validateSportsPayload({
      entries: [teamSportEntry, { ...teamSportEntry, homeTeamId: 101, awayTeamId: 201 }],
    });
    expect(result.ok).toBe(true);
  });
});
