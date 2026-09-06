import { describe, expect, it } from "vitest";
import { summarizeExercise, summarizeHappiness, summarizeSleep } from "@/lib/recap-health";
import { previousPeriod, yearPeriod } from "@/lib/recap";

// Covers the folds behind the health & wellness section (issue #201): the
// period split, high/low selection and its tie-breaking, and the
// days-trained-vs-rows distinction that the exercise card depends on.

const period = yearPeriod(2025);
const prior = previousPeriod(period);

describe("summarizeHappiness", () => {
  it("averages each period separately", () => {
    const result = summarizeHappiness(
      [
        { date: "2024-06-01", happiness: 40 },
        { date: "2025-06-01", happiness: 60 },
        { date: "2025-06-02", happiness: 80 },
      ],
      period,
      prior
    );
    expect(result).toMatchObject({ average: 70, priorAverage: 40, daysLogged: 2, priorDaysLogged: 1 });
  });

  it("picks the highest and lowest day of the period, with dates", () => {
    const result = summarizeHappiness(
      [
        { date: "2025-02-01", happiness: 55 },
        { date: "2025-03-12", happiness: 94 },
        { date: "2025-09-04", happiness: 12 },
      ],
      period,
      prior
    );
    expect(result.best).toEqual({ date: "2025-03-12", happiness: 94 });
    expect(result.worst).toEqual({ date: "2025-09-04", happiness: 12 });
  });

  it("breaks ties toward the earlier day", () => {
    // Stability matters more than which day wins: the card must not change
    // its answer between requests.
    const result = summarizeHappiness(
      [
        { date: "2025-01-05", happiness: 90 },
        { date: "2025-11-20", happiness: 90 },
      ],
      period,
      prior
    );
    expect(result.best?.date).toBe("2025-01-05");
  });

  it("never picks a best or worst day from outside the period", () => {
    const result = summarizeHappiness(
      [
        { date: "2024-01-01", happiness: 100 },
        { date: "2025-05-05", happiness: 30 },
      ],
      period,
      prior
    );
    expect(result.best).toEqual({ date: "2025-05-05", happiness: 30 });
    expect(result.priorAverage).toBe(100);
  });

  it("reports nothing rather than zero when the period has no scores", () => {
    const result = summarizeHappiness([{ date: "2024-01-01", happiness: 50 }], period, prior);
    expect(result).toMatchObject({ average: null, daysLogged: 0, best: null, worst: null });
  });
});

describe("summarizeSleep", () => {
  it("averages nightly duration and finds the extremes", () => {
    const result = summarizeSleep(
      [
        { date: "2025-01-01", durationMinutes: 400 },
        { date: "2025-01-02", durationMinutes: 500 },
        { date: "2024-01-01", durationMinutes: 300 },
      ],
      period,
      prior
    );
    expect(result).toMatchObject({
      averageMinutes: 450,
      priorAverageMinutes: 300,
      nightsLogged: 2,
      priorNightsLogged: 1,
    });
    expect(result.longest?.date).toBe("2025-01-02");
    expect(result.shortest?.date).toBe("2025-01-01");
  });

  it("has no extremes when the period has no logged nights", () => {
    const result = summarizeSleep([], period, prior);
    expect(result).toMatchObject({ averageMinutes: null, longest: null, shortest: null });
  });
});

describe("summarizeExercise", () => {
  it("counts days trained, not workout rows", () => {
    // One session of eight exercises is eight rows and one day. "412
    // workouts" is the number that flatters; "days trained" is the claim.
    const result = summarizeExercise(
      [
        { date: "2025-04-01" },
        { date: "2025-04-01" },
        { date: "2025-04-01" },
        { date: "2025-04-02" },
      ],
      period,
      prior
    );
    expect(result.daysTrained).toBe(2);
    expect(result.exercisesLogged).toBe(4);
  });

  it("counts the prior period's days separately", () => {
    const result = summarizeExercise(
      [{ date: "2024-04-01" }, { date: "2024-04-02" }, { date: "2025-04-01" }],
      period,
      prior
    );
    expect(result).toMatchObject({ daysTrained: 1, priorDaysTrained: 2 });
  });

  it("reports zero for a period with no workouts", () => {
    const result = summarizeExercise([{ date: "2019-01-01" }], period, prior);
    expect(result).toMatchObject({ daysTrained: 0, priorDaysTrained: 0, exercisesLogged: 0 });
  });
});
