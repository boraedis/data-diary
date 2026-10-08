// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecapHealthSection } from "./recap-health-section";
import type { RecapHealth } from "@/lib/recap-health";

// #531's "Where you slept" block: the located-night gate and the prior
// columns. Private page, so this is the check that it renders as specified.
// jsdom: wiring, not appearance.

function health(locatedNights: number, priorLocatedNights = 0): RecapHealth {
  return {
    happiness: {
      average: null, priorAverage: null, daysLogged: 0, priorDaysLogged: 0,
      best: null, worst: null, streak: null, priorStreak: null, series: [],
    },
    sleep: {
      averageMinutes: 420, priorAverageMinutes: null, nightsLogged: 200, priorNightsLogged: 0,
      longest: null, shortest: null,
      locations: {
        locatedNights,
        priorLocatedNights,
        rows: [{ label: "Home", other: false, colorIndex: 0, nights: locatedNights, averageMinutes: 430, priorNights: priorLocatedNights, priorAverageMinutes: 410 }],
      },
      naps: { totalMinutes: 90, daysWithNap: 3, priorTotalMinutes: 0, priorDaysWithNap: 0 },
    },
    exercise: { daysTrained: 0, priorDaysTrained: 0, exercisesLogged: 0, mix: [] },
  };
}

describe("RecapHealthSection sleep locations", () => {
  it("shows the not-enough-data state below the located-night threshold", () => {
    render(<RecapHealthSection health={health(13)} periodLabel="2025" priorLabel="2024" />);
    expect(screen.getByText("13 of 200 nights have a location recorded.")).toBeTruthy();
    expect(screen.getByText(/Only 13 nights with a location — needs 14\./)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the breakdown, with the prior period beside it when that has enough too", () => {
    render(<RecapHealthSection health={health(30, 20)} periodLabel="2025" priorLabel="2024" />);
    const table = screen.getByRole("table");
    expect(table.textContent).toContain("Home");
    expect(table.textContent).toContain("7h 10m");
    expect(table.textContent).toContain("2024");
    expect(table.textContent).toContain("6h 50m");
    expect(screen.getByRole("link", { name: /Sleep Locations/ }).getAttribute("href")).toBe("/charts/sleep-locations");
  });

  it("shows nap time as its own figure", () => {
    render(<RecapHealthSection health={health(0)} periodLabel="2025" priorLabel="2024" />);
    expect(screen.getByText("Nap time")).toBeTruthy();
    expect(screen.getByText("1h 30m")).toBeTruthy();
    expect(screen.getByText("3 days with a nap")).toBeTruthy();
  });
});
