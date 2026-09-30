import { describe, expect, it } from "vitest";
import { previousPeriod, yearPeriod } from "@/lib/recap";
import { summarizeDaily, summarizeTraining, summarizeWeight } from "@/lib/recap-body";

// The body & habits rules (#529): averages are over *logged* days only,
// weight reports its first and last weigh-in, and training hours ignore
// untimed workouts.

const period = yearPeriod(2025);
const prior = previousPeriod(period);

describe("summarizeDaily", () => {
  it("averages only logged days and splits the periods", () => {
    const result = summarizeDaily(
      [
        { date: "2024-06-01", value: 1 },
        { date: "2025-01-01", value: 2 },
        { date: "2025-01-02", value: 4 },
        { date: "2026-01-01", value: 99 },
      ],
      period,
      prior
    );
    expect(result).toMatchObject({ average: 3, daysLogged: 2, total: 6, priorAverage: 1, priorDaysLogged: 1 });
  });

  it("has a null average, not zero, when nothing was logged", () => {
    expect(summarizeDaily([], period, prior)).toMatchObject({ average: null, daysLogged: 0, priorAverage: null });
  });

  it("counts a recorded zero as a logged day", () => {
    const result = summarizeDaily([{ date: "2025-03-01", value: 0 }], period, prior);
    expect(result).toMatchObject({ average: 0, daysLogged: 1 });
  });
});

describe("summarizeWeight", () => {
  it("reports the first and last weigh-in inside the period", () => {
    const result = summarizeWeight(
      [
        { date: "2024-12-30", value: 80 },
        { date: "2025-01-05", value: 78 },
        { date: "2025-06-01", value: 77 },
        { date: "2025-12-20", value: 75 },
      ],
      period,
      prior
    );
    expect(result.first).toEqual({ date: "2025-01-05", value: 78 });
    expect(result.last).toEqual({ date: "2025-12-20", value: 75 });
    expect(result.series).toHaveLength(3);
  });

  it("has no first/last for an unweighed period", () => {
    expect(summarizeWeight([], period, prior)).toMatchObject({ first: null, last: null });
  });
});

describe("summarizeTraining", () => {
  it("sums timed hours and ignores untimed workouts", () => {
    const result = summarizeTraining(
      [
        { date: "2025-02-01", hours: 1.5 },
        { date: "2025-02-01", hours: 0.5 },
        { date: "2025-02-02", hours: 0 },
        { date: "2024-02-01", hours: 3 },
      ],
      period,
      prior
    );
    expect(result).toEqual({ hours: 2, daysTrained: 1, priorHours: 3, priorDaysTrained: 1 });
  });
});
