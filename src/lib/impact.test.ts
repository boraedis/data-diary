import { describe, expect, it } from "vitest";
import { personImpact, recencyWeight } from "@/lib/impact";

// Pins legacy's people-impact formula (#232). These aren't tests of
// something derived — they're a fence around a verbatim port, so an
// intuitive-looking "fix" fails loudly rather than silently rewriting years
// of remembered numbers.

/** The legacy implementation, transcribed independently from
 * `vis_functions.js:690-703`, to check the port against rather than
 * checking the port against itself. */
function legacyImpact(h: number, r: number): number {
  const p = (x: number) => (x + 1.2) * ((x - 0.8) ** 2 / (1.5 - x)) + 0.05;
  const n = (x: number) => -(2 ** (-2 * x)) + 0.25;
  if (r > 0) return [1.15, 1.1, 1.06, 1.02, 1, 0.98, 0.96][r - 1] * p(h / 100) * 12;
  return [1.2, 1, 0.8][-r] * n(h / 100) * 12;
}

describe("personImpact", () => {
  it("matches legacy across the happiness range and every slot", () => {
    for (const h of [0, 10, 25, 47, 50, 68, 80, 88, 95, 100]) {
      for (const slot of [1, 2, 3, 4, 5, 6, 7, 0, -1, -2]) {
        expect(personImpact(h, slot)).toBeCloseTo(legacyImpact(h, slot), 10);
      }
    }
  });

  it("weights earlier positive slots more heavily", () => {
    const scores = [1, 2, 3, 4, 5, 6, 7].map((slot) => personImpact(80, slot));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it("is U-shaped over happiness, not monotonic — this is intended", () => {
    // The surprising property, pinned deliberately: the minimum sits near
    // 80, and a very bad day scores *higher* than a merely good one. Any
    // change that makes this monotonic is rewriting the formula, not
    // fixing it — see #232.
    const worst = personImpact(0, 1);
    const middling = personImpact(80, 1);
    const best = personImpact(100, 1);
    expect(middling).toBeLessThan(best);
    expect(middling).toBeLessThan(worst);
    expect(worst).toBeGreaterThan(best);
  });

  it("bottoms out at a happiness of 80", () => {
    const at80 = personImpact(80, 5);
    for (const h of [60, 70, 75, 85, 90, 100]) {
      expect(personImpact(h, 5)).toBeGreaterThan(at80);
    }
  });

  it("keeps positive-slot scores positive across the whole range", () => {
    // What makes these stackable in an area chart — the negative branch is
    // not, and is excluded from that chart for exactly this reason.
    for (const h of [0, 25, 50, 80, 100]) {
      expect(personImpact(h, 1)).toBeGreaterThan(0);
    }
  });

  it("returns negative scores for a negative slot on a poor day", () => {
    expect(personImpact(0, 0)).toBeLessThan(0);
    expect(personImpact(100, 0)).toBeCloseTo(0, 6);
  });

  it("returns zero for a slot outside the known range", () => {
    expect(personImpact(80, 8)).toBe(0);
    expect(personImpact(80, -3)).toBe(0);
  });
});

describe("recencyWeight", () => {
  it("counts today at full weight", () => {
    expect(recencyWeight(0)).toBeCloseTo(1, 10);
  });

  it("has fallen to roughly half a year in", () => {
    // The inflection point of legacy's curve, and the reason a race built
    // on it keeps moving: a year of absence costs about half your score.
    expect(recencyWeight(365)).toBeCloseTo(0.539, 3);
  });

  it("decreases with age and never reaches zero", () => {
    const ages = [0, 30, 180, 365, 730, 3650];
    const weights = ages.map(recencyWeight);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeLessThan(weights[i - 1]);
    expect(weights.at(-1)).toBeGreaterThan(0.05);
  });

  it("clamps a negative age rather than weighting a future day above 1", () => {
    expect(recencyWeight(-100)).toBe(recencyWeight(0));
  });
});
