import { describe, expect, it } from "vitest";
import { addDays, daysBetween } from "@/lib/date";
import { personImpact, recencyWeight } from "@/lib/impact";
import type { PeopleDay, PersonOnDay } from "@/lib/charts";
import {
  buildImpactTimeline,
  dailyStandings,
  impactTrendTags,
  meanStanding,
  rankPeople,
  resolveSelection,
  TAG_MEMBER_MIN_DAYS,
} from "@/lib/people-impact-trend";

const person = (name: string, slot: number, tagName: string | null = null): PersonOnDay => ({
  name,
  slot,
  tagName,
  tagColor: tagName ? "#123456" : null,
});

/** A few months of a small, irregular log: gaps, an unscored day, people
 * appearing and disappearing, one arriving late. */
function sampleData(): PeopleDay[] {
  const days: PeopleDay[] = [];
  const start = "2020-01-01";
  for (let i = 0; i < 200; i++) {
    if (i % 5 === 3) continue; // gaps in the log
    const people: PersonOnDay[] = [];
    if (i < 120) people.push(person("Ana", 1, "Family"));
    if (i % 2 === 0) people.push(person("Ben", 2, "Work"));
    if (i > 90) people.push(person("Cy", 3, "Work"));
    days.push({ date: addDays(start, i), happiness: i === 10 ? null : 40 + (i % 50), people });
  }
  return days;
}

/** Legacy's own day-by-day loop (`people_impact_averager.js`), to check the
 * prefix-sum closed form against rather than against itself. */
function bruteMean(data: PeopleDay[], name: string, from: string, to: string): number | null {
  const start = data.find((d) => d.happiness !== null)!.date;
  const values: number[] = [];
  for (let i = daysBetween(start, from); i <= daysBetween(start, to); i++) {
    let standing = 0;
    for (const day of data) {
      const j = daysBetween(start, day.date);
      if (j > i || day.happiness === null) continue;
      for (const p of day.people) {
        if (p.name === name) standing += recencyWeight(i - j) * personImpact(day.happiness, p.slot);
      }
    }
    // Days before their first appearance are exactly zero and excluded.
    if (standing > 0 || values.length > 0) values.push(standing);
  }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

describe("meanStanding", () => {
  const data = sampleData();
  const timeline = buildImpactTimeline(data)!;

  it("matches legacy's day-by-day average", () => {
    for (const name of ["Ana", "Ben", "Cy"]) {
      for (const [from, to] of [
        ["2020-01-01", "2020-01-31"],
        ["2020-03-10", "2020-05-02"],
        ["2020-06-01", "2020-07-18"],
      ]) {
        const s = daysBetween(timeline.start, from);
        const e = daysBetween(timeline.start, to);
        const expected = bruteMean(data, name, from, to);
        const actual = meanStanding(timeline, name, s, e);
        if (expected === null) expect(actual).toBeNull();
        else expect(actual).toBeCloseTo(expected, 9);
      }
    }
  });

  it("is null for a period before someone's first appearance", () => {
    expect(meanStanding(timeline, "Cy", 0, 30)).toBeNull();
    expect(meanStanding(timeline, "Nobody", 0, 30)).toBeNull();
  });

  it("holds for months after someone leaves, then decays toward the fader's floor, never to zero", () => {
    // One appearance, then years of other people. The fader sits near 1
    // for the first few months and falls off around the year mark.
    const data: PeopleDay[] = [{ date: "2020-01-01", happiness: 60, people: [person("Gone", 1)] }];
    for (let i = 1; i <= 1500; i += 7) {
      data.push({ date: addDays("2020-01-01", i), happiness: 60, people: [person("Other", 1)] });
    }
    const t = buildImpactTimeline(data)!;
    const first = meanStanding(t, "Gone", 0, 0)!;
    expect(meanStanding(t, "Gone", 90, 90)!).toBeGreaterThan(first * 0.9);
    const late = meanStanding(t, "Gone", 1400, 1400)!;
    expect(late).toBeLessThan(first * 0.1);
    expect(late).toBeGreaterThan(0);
  });
});

describe("buildImpactTimeline", () => {
  it("counts unscored days as logged but not as impact", () => {
    const timeline = buildImpactTimeline(sampleData())!;
    const ana = timeline.byName.get("Ana")!;
    expect(ana.daysLogged).toBe(timeline.appearances.get("Ana")!.loggedDay.length);
    expect(timeline.appearances.get("Ana")!.day.length).toBe(ana.daysLogged - 1);
  });

  it("returns null with no scored day at all", () => {
    expect(buildImpactTimeline([{ date: "2020-01-01", happiness: null, people: [person("A", 1)] }])).toBeNull();
  });
});

describe("dailyStandings", () => {
  const data = sampleData();
  const timeline = buildImpactTimeline(data)!;

  it("matches legacy's per-day standing on every day", () => {
    for (const name of ["Ana", "Ben", "Cy"]) {
      const series = dailyStandings(timeline, name);
      for (const i of [0, 1, 17, 90, 91, 150, timeline.lastDay]) {
        const date = addDays(timeline.start, i);
        expect(series[i]).toBeCloseTo(bruteMean(data, name, date, date) ?? 0, 9);
      }
    }
  });

  it("is zero before someone's first appearance", () => {
    const cy = dailyStandings(timeline, "Cy");
    expect(cy[90]).toBe(0);
    expect(cy[91]).toBeGreaterThan(0);
  });

  it("returns the cached series for a repeat call", () => {
    expect(dailyStandings(timeline, "Ben")).toBe(dailyStandings(timeline, "Ben"));
  });
});

describe("rankPeople", () => {
  const timeline = buildImpactTimeline(sampleData())!;

  it("ranks over the window, not all time", () => {
    // Ana dominates early and is gone by day 120; Cy only arrives at 91.
    expect(rankPeople(timeline, "logged", 0, 60, 3)[0]).toBe("Ana");
    expect(rankPeople(timeline, "logged", 130, 199, 3)).toEqual(["Cy", "Ben"]);
    expect(rankPeople(timeline, "impact", 0, 60, 1)).toEqual(["Ana"]);
  });

  it("respects the limit", () => {
    expect(rankPeople(timeline, "impact", 0, timeline.lastDay, 2)).toHaveLength(2);
  });
});

describe("resolveSelection", () => {
  const timeline = buildImpactTimeline(sampleData())!;

  it("composes hand-picked people, tags and a preset, first source winning", () => {
    const shown = resolveSelection(timeline, { preset: "impact", tags: ["Work"], people: ["Cy"], excluded: [] });
    expect(shown.map((p) => [p.name, p.via.kind])).toEqual([
      ["Cy", "person"],
      ["Ben", "tag"],
      ["Ana", "preset"],
    ]);
  });

  it("drops excluded people whichever control brought them in", () => {
    const shown = resolveSelection(timeline, { preset: "impact", tags: ["Work"], people: [], excluded: ["Ben"] });
    expect(shown.map((p) => p.name)).not.toContain("Ben");
  });

  it("only pulls in tag members logged often enough", () => {
    const data: PeopleDay[] = [];
    for (let i = 0; i < TAG_MEMBER_MIN_DAYS; i++) {
      const people = [person("Regular", 1, "Club")];
      if (i === 0) people.push(person("Once", 2, "Club"));
      data.push({ date: addDays("2021-01-01", i), happiness: 60, people });
    }
    const t = buildImpactTimeline(data)!;
    const shown = resolveSelection(t, { preset: "none", tags: ["Club"], people: [], excluded: [] });
    expect(shown.map((p) => p.name)).toEqual(["Regular"]);
    expect(impactTrendTags(t)).toEqual([{ name: "Club", color: "#123456", members: 1 }]);
    // ...but can still be added by name.
    const withOnce = resolveSelection(t, { preset: "none", tags: ["Club"], people: ["Once"], excluded: [] });
    expect(withOnce.map((p) => p.name)).toEqual(["Once", "Regular"]);
  });
});
