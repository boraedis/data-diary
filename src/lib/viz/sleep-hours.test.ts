import { describe, expect, it } from "vitest";
import { buildSleepBars, clockTicks, fitClockDomain, formatAxisClock, toAxisMinutes } from "@/lib/viz/sleep-hours";

const hm = (h: number, m = 0) => h * 60 + m;

describe("toAxisMinutes / formatAxisClock", () => {
  it("puts noon at the origin and midnight in the middle", () => {
    expect(toAxisMinutes(hm(12))).toBe(0);
    expect(toAxisMinutes(hm(0))).toBe(hm(12));
    expect(toAxisMinutes(hm(23))).toBe(hm(11));
    expect(toAxisMinutes(hm(1))).toBe(hm(13));
  });

  it("round-trips clock times", () => {
    for (const t of [hm(0), hm(1, 35), hm(11, 59), hm(12), hm(22, 33)]) {
      const clock = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      expect(formatAxisClock(toAxisMinutes(t))).toBe(clock);
    }
  });

  it("wraps values past 24h back onto the clock face", () => {
    expect(formatAxisClock(24 * 60 + hm(2))).toBe("14:00");
  });
});

describe("buildSleepBars", () => {
  it("draws a night across midnight as one unbroken bar", () => {
    const [bar] = buildSleepBars([{ date: "2026-09-24", bedtimeMinutes: hm(22, 33), durationMinutes: 527 }]);
    expect(bar.start).toBe(hm(10, 33));
    expect(bar.end).toBe(hm(10, 33) + 527);
    expect(formatAxisClock(bar.end)).toBe("07:20");
  });

  it("places an after-midnight bedtime below an evening one, not at the top", () => {
    const [evening, late] = buildSleepBars([
      { date: "2026-09-19", bedtimeMinutes: hm(23), durationMinutes: 480 },
      { date: "2026-09-20", bedtimeMinutes: hm(1, 35), durationMinutes: 150 },
    ]);
    expect(late.start).toBeGreaterThan(evening.start);
  });
});

describe("fitClockDomain", () => {
  it("fits the visible nights out to whole hours", () => {
    const bars = buildSleepBars([
      { date: "a", bedtimeMinutes: hm(22, 10), durationMinutes: 600 }, // to 08:10
      { date: "b", bedtimeMinutes: hm(2, 40), durationMinutes: 420 }, // to 09:40
    ]);
    expect(fitClockDomain(bars)).toEqual([toAxisMinutes(hm(22)), toAxisMinutes(hm(10))]);
  });

  it("widens a narrow span to at least eight hours", () => {
    const bars = buildSleepBars([{ date: "a", bedtimeMinutes: hm(0), durationMinutes: 120 }]);
    const [lo, hi] = fitClockDomain(bars);
    expect(hi - lo).toBe(8 * 60);
    expect(lo).toBeLessThanOrEqual(toAxisMinutes(hm(0)));
    expect(hi).toBeGreaterThanOrEqual(toAxisMinutes(hm(2)));
  });

  it("never grows above the noon origin", () => {
    const bars = buildSleepBars([{ date: "a", bedtimeMinutes: hm(12, 30), durationMinutes: 60 }]);
    expect(fitClockDomain(bars)[0]).toBe(0);
  });

  it("extends past 24h rather than cutting a night that runs beyond the next noon", () => {
    const bars = buildSleepBars([{ date: "a", bedtimeMinutes: hm(4), durationMinutes: 11 * 60 }]); // to 15:00
    expect(fitClockDomain(bars)[1]).toBe(27 * 60);
  });
});

describe("fitClockDomain over a long range", () => {
  it("ignores a stray outlier row instead of stretching the axis to it", () => {
    const nights = Array.from({ length: 400 }, (_, i) => ({
      date: `n${i}`,
      bedtimeMinutes: hm(23) + (i % 60),
      durationMinutes: 480,
    }));
    nights.push({ date: "odd", bedtimeMinutes: hm(12, 30), durationMinutes: 19 * 60 });
    const [lo, hi] = fitClockDomain(buildSleepBars(nights));
    expect(lo).toBe(toAxisMinutes(hm(23)));
    expect(hi).toBe(toAxisMinutes(hm(8)));
  });
});

describe("clockTicks", () => {
  it("steps up from hourly as the axis gets shorter", () => {
    const domain: [number, number] = [hm(10), hm(22)];
    expect(clockTicks(domain, 600)).toHaveLength(13);
    const coarse = clockTicks(domain, 200);
    expect(coarse.length).toBeLessThan(13);
    expect(coarse.every((t) => t % 60 === 0)).toBe(true);
  });
});
