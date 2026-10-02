import { describe, expect, it } from "vitest";
import { chainRoleEnds } from "@/lib/life-timeline";
import { describeSpan, previousPeriod } from "@/lib/recap";
import {
  buildChapters,
  chapterPeriod,
  countDatesInRange,
  isChapterPublished,
  isCompactChapter,
  summarizeChapters,
  type RecapChapter,
} from "@/lib/recap-chapters";

type Occupation = Parameters<typeof buildChapters>[0]["occupations"][number];

function occupation(overrides: Partial<Occupation> & Pick<Occupation, "id" | "start" | "end">): Occupation {
  return {
    name: `Job ${overrides.id}`,
    type: "work",
    alias: null,
    position: null,
    company: null,
    placeName: null,
    color: null,
    roles: [],
    ...overrides,
  };
}

function chapter(overrides: Partial<RecapChapter> & Pick<RecapChapter, "start" | "end">): RecapChapter {
  return {
    key: "residence-1",
    kind: "residence",
    title: "Home",
    detail: null,
    parentKey: null,
    color: null,
    ...overrides,
  };
}

describe("buildChapters", () => {
  it("makes one chapter per job, home and relationship, oldest first", () => {
    const chapters = buildChapters({
      occupations: [occupation({ id: 2, start: "2020-01-01", end: "2021-01-01", alias: "Acme" })],
      residences: [
        { id: 5, name: "Flat", alias: null, placeName: "Arlington", start: "2018-01-01", end: null, color: "#123456" },
      ],
      relationships: [
        { id: 9, name: "R", alias: null, personName: "Sam", start: "2022-01-01", end: "2023-01-01", color: null },
      ],
    });
    expect(chapters.map((c) => [c.key, c.kind, c.title])).toEqual([
      ["residence-5", "residence", "Flat"],
      ["occupation-2", "work", "Acme"],
      ["relationship-9", "relationship", "R"],
    ]);
    // Recorded ends are believed; null stays null (ongoing), never chained
    // to whatever starts next.
    expect(chapters[0].end).toBeNull();
  });

  it("keeps education apart from work (#560)", () => {
    const [school] = buildChapters({
      occupations: [occupation({ id: 1, type: "education", start: "2010-09-01", end: "2014-06-01" })],
      residences: [],
      relationships: [],
    });
    expect(school.kind).toBe("education");
  });

  it("does not chain overlapping jobs — a side job doesn't end the main one", () => {
    const chapters = buildChapters({
      occupations: [
        occupation({ id: 1, start: "2023-01-28", end: null }),
        occupation({ id: 2, start: "2024-08-17", end: "2026-08-07" }),
      ],
      residences: [],
      relationships: [],
    });
    expect(chapters.find((c) => c.key === "occupation-1")?.end).toBeNull();
  });

  it("chains roles with the life-timeline's rule, and only for jobs with more than one", () => {
    const roles = [
      { id: 11, occupationId: 7, position: "Senior", start: "2024-03-01", end: null },
      { id: 10, occupationId: 7, position: "Engineer", start: "2023-01-28", end: null },
    ];
    const chapters = buildChapters({
      occupations: [
        occupation({ id: 7, alias: "Acme", start: "2023-01-28", end: "2025-02-14", roles }),
        occupation({
          id: 8,
          start: "2025-03-01",
          end: null,
          roles: [{ id: 12, occupationId: 8, position: "Lead", start: "2025-03-01", end: null }],
        }),
      ],
      residences: [],
      relationships: [],
    });

    const roleChapters = chapters.filter((c) => c.kind === "role");
    expect(roleChapters.map((c) => [c.key, c.title, c.start, c.end, c.parentKey])).toEqual([
      ["role-10", "Engineer at Acme", "2023-01-28", "2024-03-01", "occupation-7"],
      ["role-11", "Senior at Acme", "2024-03-01", "2025-02-14", "occupation-7"],
    ]);
    // Same answer as the shared helper the life-timeline draws with.
    expect(roleChapters.map((c) => c.end)).toEqual(chainRoleEnds(roles, "2025-02-14").map((r) => r.end));
    // The single-role job got no role chapter of its own.
    expect(chapters.some((c) => c.key === "role-12")).toBe(false);
  });

  it("leaves the last role of an ongoing job ongoing", () => {
    const chapters = buildChapters({
      occupations: [
        occupation({
          id: 1,
          start: "2025-01-01",
          end: null,
          roles: [
            { id: 1, occupationId: 1, position: "A", start: "2025-01-01", end: null },
            { id: 2, occupationId: 1, position: "B", start: "2026-01-01", end: null },
          ],
        }),
      ],
      residences: [],
      relationships: [],
    });
    expect(chapters.find((c) => c.key === "role-1")?.end).toBe("2026-01-01");
    expect(chapters.find((c) => c.key === "role-2")?.end).toBeNull();
  });
});

describe("isChapterPublished", () => {
  const ended = chapter({ start: "2025-01-01", end: "2025-06-30" });

  it("follows the publish gate's grace window after the chapter's end", () => {
    expect(isChapterPublished(ended, "2025-07-03")).toBe(false);
    expect(isChapterPublished(ended, "2025-07-04")).toBe(true);
  });

  it("never publishes an ongoing chapter, however long it has run", () => {
    expect(isChapterPublished(chapter({ start: "2015-01-01", end: null }), "2026-10-02")).toBe(false);
  });

  it("gives an ongoing chapter today as its period end, for the preview", () => {
    expect(chapterPeriod(chapter({ start: "2025-02-14", end: null }), "2026-10-02").end).toBe("2026-10-02");
  });
});

describe("summarizeChapters", () => {
  const logged = ["2016-02-18", "2016-03-01", "2018-01-01", "2018-01-02"];

  it("drops chapters with no logged day — they ended before the diary began", () => {
    const summaries = summarizeChapters(
      [
        chapter({ key: "occupation-1", start: "2008-08-31", end: "2015-06-07" }),
        chapter({ key: "occupation-2", start: "2008-08-31", end: "2016-06-07" }),
      ],
      logged,
      "2026-10-02"
    );
    expect(summaries.map((s) => [s.key, s.loggedDays])).toEqual([["occupation-2", 2]]);
  });

  it("drops chapters that haven't ended", () => {
    expect(summarizeChapters([chapter({ start: "2016-01-01", end: null })], logged, "2026-10-02")).toEqual([]);
  });
});

describe("countDatesInRange", () => {
  const dates = ["2020-01-01", "2020-01-02", "2020-01-05", "2020-02-01"];

  it("counts inclusively at both ends", () => {
    expect(countDatesInRange(dates, "2020-01-02", "2020-01-05")).toBe(2);
    expect(countDatesInRange(dates, "2019-01-01", "2030-01-01")).toBe(4);
    expect(countDatesInRange(dates, "2020-01-03", "2020-01-04")).toBe(0);
    expect(countDatesInRange([], "2020-01-01", "2020-12-31")).toBe(0);
  });
});

describe("chapter scale", () => {
  it("treats a season-long chapter as compact and a long one as not", () => {
    expect(isCompactChapter(chapterPeriod(chapter({ start: "2022-06-04", end: "2022-08-10" }), "2026-01-01"))).toBe(
      true
    );
    expect(isCompactChapter(chapterPeriod(chapter({ start: "2018-08-12", end: "2022-12-15" }), "2026-01-01"))).toBe(
      false
    );
  });
});

describe("a chapter's prior period", () => {
  it("is the equal-length stretch just before it, named relatively", () => {
    const period = chapterPeriod(chapter({ start: "2022-06-04", end: "2022-08-10" }), "2026-01-01");
    const prior = previousPeriod(period);
    expect(prior.end).toBe("2022-06-03");
    expect(prior.start).toBe("2022-03-28");
    expect(prior.label).toBe("the 2 months before");
  });

  it("drops the count from a single unit", () => {
    const year = chapterPeriod(chapter({ start: "2021-05-08", end: "2022-05-09" }), "2026-01-01");
    expect(previousPeriod(year).label).toBe("the year before");
  });
});

describe("describeSpan", () => {
  it("names a span in the unit a person would use", () => {
    expect(describeSpan(1)).toBe("1 day");
    expect(describeSpan(10)).toBe("10 days");
    expect(describeSpan(30)).toBe("4 weeks");
    expect(describeSpan(91)).toBe("3 months");
    expect(describeSpan(339)).toBe("11 months");
    expect(describeSpan(365)).toBe("1 year");
    expect(describeSpan(480)).toBe("1½ years");
    expect(describeSpan(731)).toBe("2 years");
    expect(describeSpan(Math.round(365.25 * 8.5))).toBe("8½ years");
  });
});
