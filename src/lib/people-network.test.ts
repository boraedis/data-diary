import { describe, expect, it } from "vitest";
import {
  buildPeopleNetwork,
  hypergeometricUpperTail,
  MIN_SHARED_DAYS,
  significanceCutoff,
  type PeopleNetworkDay,
  type PeopleNetworkPerson,
} from "./people-network";
import { parseDate } from "./date";

// Pure tests for the network's statistics and graph building. The
// primitive that draws the result is exercised in the browser, not here —
// see the PR for what was verified visually.

/** Brute-force P(X ≥ k) straight from the hypergeometric pmf with exact
 * binomials — slow, but an independent check on the log-space version. */
function bruteUpperTail(N: number, a: number, b: number, k: number): number {
  const choose = (n: number, r: number): number => {
    if (r < 0 || r > n) return 0;
    let out = 1;
    for (let i = 1; i <= r; i++) out = (out * (n - r + i)) / i;
    return out;
  };
  let sum = 0;
  for (let x = k; x <= Math.min(a, b); x++) sum += (choose(a, x) * choose(N - a, b - x)) / choose(N, b);
  return sum;
}

describe("hypergeometricUpperTail", () => {
  it("matches a brute-force sum on small populations", () => {
    for (const [N, a, b, k] of [
      [20, 5, 7, 3],
      [30, 10, 10, 6],
      [50, 12, 4, 2],
      [40, 20, 20, 12],
    ]) {
      expect(hypergeometricUpperTail(N, a, b, k)).toBeCloseTo(bruteUpperTail(N, a, b, k), 12);
    }
  });

  it("is 1 at or below the smallest possible overlap and 0 above the largest", () => {
    expect(hypergeometricUpperTail(100, 10, 20, 0)).toBe(1);
    // a + b - N = 30 people-days must overlap when 60 + 70 > 100.
    expect(hypergeometricUpperTail(100, 60, 70, 30)).toBe(1);
    expect(hypergeometricUpperTail(100, 10, 20, 11)).toBe(0);
  });

  it("gives a tiny p for an overlap far above what chance predicts", () => {
    // Expected overlap is 10·10/1000 = 0.1 days; seeing 10 is not chance.
    expect(hypergeometricUpperTail(1000, 10, 10, 10)).toBeLessThan(1e-20);
  });

  it("gives a large p for an overlap at the expected level", () => {
    // Expected overlap is 100·100/1000 = 10 days.
    expect(hypergeometricUpperTail(1000, 100, 100, 10)).toBeGreaterThan(0.4);
  });
});

describe("significanceCutoff", () => {
  it("Bonferroni divides alpha by every tested pair", () => {
    expect(significanceCutoff([0.001], 100, "bonferroni", 0.01)).toBeCloseTo(0.0001);
  });

  it("Benjamini–Hochberg passes the largest p under its rank's bar", () => {
    // m = 10, α = 0.1 → bars 0.01, 0.02, 0.03, …. The third-smallest p
    // (0.025) is under its bar (0.03), so it and everything below pass,
    // even though the second (0.021) is over *its* own bar (0.02).
    const ps = [0.001, 0.021, 0.025, 0.5, 0.9];
    expect(significanceCutoff(ps, 10, "bh", 0.1)).toBe(0.025);
  });

  it("passes nothing when nothing clears the first bar", () => {
    expect(significanceCutoff([0.5, 0.9], 10, "bh", 0.05)).toBe(0);
  });
});

// A small diary: 60 days. Ann and Bob are nearly always together; Cat is
// logged often but independently of both; Dee is rare.
function fixture(): { days: PeopleNetworkDay[]; people: PeopleNetworkPerson[] } {
  const people: PeopleNetworkPerson[] = [
    { id: 1, name: "Ann", tagId: 1, tagName: "Friends", color: "#f00" },
    { id: 2, name: "Bob", tagId: 1, tagName: "Friends", color: "#f00" },
    { id: 3, name: "Cat", tagId: 2, tagName: "Work", color: "#00f" },
    { id: 4, name: "Dee", tagId: null, tagName: null, color: null },
  ];
  const days: PeopleNetworkDay[] = [];
  for (let i = 0; i < 60; i++) {
    const date = `2020-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    const ids: number[] = [];
    if (i < 20) ids.push(1, 2); // Ann + Bob together on 20 days
    if (i % 3 === 0) ids.push(3); // Cat every third day, 20 days
    if (i === 59) ids.push(4);
    days.push({ date, people: ids });
  }
  return { days, people };
}

describe("buildPeopleNetwork", () => {
  it("keeps only people at or over the mention floor", () => {
    const net = buildPeopleNetwork(fixture(), { minMentions: 5, strictness: "significant", range: null });
    expect(net.nodes.map((n) => n.name).sort()).toEqual(["Ann", "Bob", "Cat"]);
  });

  it("draws an edge for a pair seen together far above chance, not for an independent one", () => {
    const net = buildPeopleNetwork(fixture(), { minMentions: 5, strictness: "significant", range: null });
    const pairs = net.edges.map((e) => [e.source, e.target].sort().join("-"));
    expect(pairs).toContain("1-2");
    // Cat overlaps Ann on 7 of her days — about what chance predicts.
    expect(pairs).not.toContain("1-3");
    const annBob = net.edges.find((e) => [e.source, e.target].sort().join("-") === "1-2")!;
    expect(annBob.shared).toBe(20);
    expect(annBob.overlap).toBe(1);
  });

  it("counts N as days with anyone logged, and sorts nodes biggest-first", () => {
    const net = buildPeopleNetwork(fixture(), { minMentions: 1, strictness: "loose", range: null });
    // Days 20..59 not divisible by 3 and not day 59 have nobody logged.
    const logged = fixture().days.filter((d) => d.people.length > 0).length;
    expect(net.dayCount).toBe(logged);
    const counts = net.nodes.map((n) => n.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("never draws an edge under the shared-day floor", () => {
    const net = buildPeopleNetwork(fixture(), { minMentions: 1, strictness: "loose", range: null });
    expect(net.edges.every((e) => e.shared >= MIN_SHARED_DAYS)).toBe(true);
  });

  it("recomputes counts and first/last dates within the period", () => {
    const net = buildPeopleNetwork(fixture(), {
      minMentions: 1,
      strictness: "significant",
      range: [parseDate("2020-01-01"), parseDate("2020-01-10")],
    });
    const ann = net.nodes.find((n) => n.name === "Ann")!;
    expect(ann.count).toBe(10);
    expect(ann.first).toBe("2020-01-01");
    expect(ann.last).toBe("2020-01-10");
    expect(net.nodes.find((n) => n.name === "Dee")).toBeUndefined();
  });

  it("returns an empty graph for an empty diary", () => {
    expect(buildPeopleNetwork({ days: [], people: [] }, { minMentions: 1, strictness: "strong", range: null })).toEqual({
      nodes: [],
      edges: [],
      dayCount: 0,
    });
  });
});
