import { describe, expect, it } from "vitest";
import {
  MAX_DAILY_MINUTES,
  checkDomainDurations,
  crossDomainWarning,
  dayTotalMinutes,
  workoutMinutes,
} from "@/lib/duration-limits";

describe("checkDomainDurations", () => {
  it("passes nulls through to the caller's own required rule", () => {
    expect(checkDomainDurations("movies", [null, 90])).toBeNull();
  });
  it("names the offending value", () => {
    expect(checkDomainDurations("games", [1800])).toMatch(/can't last 30h/);
    expect(checkDomainDurations("games", [12.5])).toMatch(/12\.5 minutes/);
  });
});

describe("workoutMinutes", () => {
  it("prefers the workout's own duration, else sums its sets", () => {
    expect(workoutMinutes({ durationMinutes: 40, sets: [{ durationSeconds: 600 }] })).toBe(40);
    expect(workoutMinutes({ durationMinutes: null, sets: [{ durationSeconds: 90 }, { durationSeconds: null }, { durationSeconds: 30 }] })).toBe(2);
  });
});

describe("crossDomainWarning", () => {
  const empty = { workouts: [], entertainment: [], movies: [], tvEpisodeWatches: [], sportsWatches: [], bookSessions: [], gameSessions: [] };

  it("stays quiet up to a day, then warns with the total", () => {
    expect(crossDomainWarning(MAX_DAILY_MINUTES)).toBeNull();
    const total = dayTotalMinutes({
      ...empty,
      workouts: [{ durationMinutes: 60, sets: [] }],
      movies: [{ durationMinutes: 720 }],
      gameSessions: [{ durationMinutes: 700 }, { durationMinutes: null }],
    });
    expect(total).toBe(1480);
    expect(crossDomainWarning(total)).toMatch(/adds up to 24h 40m/);
  });
});
