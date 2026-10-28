import { describe, expect, it } from "vitest";
import { FIELDS } from "@/lib/expected-fields";
import { findingHref, parseFindingStatus, parseReviewStatus, partialFieldLinks } from "./links";
import { ENTRY_TABLES } from "./types";

// Covers where the review page (#672) links each finding, so a field
// added to the registry or an entry table added to the scan can't
// silently lose its section.

const D = "2024-03-05";

describe("findingHref", () => {
  it("links day fields to their section", () => {
    expect(findingHref({ date: D, entityTable: "days", field: "weightKg" })).toBe(`/day/${D}/weight`);
    expect(findingHref({ date: D, entityTable: "days", field: "subNi" })).toBe(`/day/${D}/subs`);
    expect(findingHref({ date: D, entityTable: "days", field: "books" })).toBe(`/day/${D}/entertainment`);
  });

  it("links entries through their table", () => {
    expect(findingHref({ date: D, entityTable: "workout_sets", field: "weightLbs" })).toBe(`/day/${D}/health`);
    expect(findingHref({ date: D, entityTable: "movie_watches", field: "rating" })).toBe(`/day/${D}/entertainment`);
  });

  it("sends multi-field and dateless findings to the overview or nowhere", () => {
    expect(findingHref({ date: D, entityTable: "days", field: null })).toBe(`/day/${D}`);
    expect(
      findingHref({ type: "partial", date: D, entityTable: "days", field: null, detail: "Missing: Weight, Journal" })
    ).toBe(`/day/${D}`);
    expect(findingHref({ date: null, entityTable: "days", field: "weight" })).toBeNull();
  });

  it("has a section for every registry field and entry table", () => {
    for (const f of FIELDS) {
      if (f.key === "music") continue; // never judged, see SCAN_FIELDS
      expect(findingHref({ date: D, entityTable: "days", field: f.key }), f.key).not.toBe(`/day/${D}`);
    }
    for (const table of [...Object.keys(ENTRY_TABLES), "workout_sets"]) {
      expect(findingHref({ date: D, entityTable: table, field: null }), table).not.toBe(`/day/${D}`);
    }
  });
});

describe("partialFieldLinks (#685)", () => {
  it("links each missing field to its own section", () => {
    expect(partialFieldLinks({ date: D, detail: "Missing: Weight, Sub K, Positive people" })).toEqual([
      { label: "Weight", href: `/day/${D}/weight` },
      { label: "Sub K", href: `/day/${D}/subs` },
      { label: "Positive people", href: `/day/${D}/people` },
    ]);
  });

  it("leaves an unknown label unlinked rather than guessing", () => {
    expect(partialFieldLinks({ date: D, detail: "Missing: Renamed thing" })).toEqual([
      { label: "Renamed thing", href: null },
    ]);
  });

  it("links a partial finding to its one section when every field shares it", () => {
    expect(
      findingHref({ type: "partial", date: D, entityTable: "days", field: null, detail: "Missing: Sub A, Sub K" })
    ).toBe(`/day/${D}/subs`);
  });

  it("can split every registry label back out of a detail", () => {
    // partial.ts joins labels with ", ", so a comma inside one would break this.
    for (const f of FIELDS) expect(f.label, f.key).not.toContain(",");
  });
});

describe("parseFindingStatus", () => {
  it("accepts the three statuses only", () => {
    expect(parseFindingStatus("dismissed")).toBe("dismissed");
    expect(parseFindingStatus("deleted")).toBeNull();
    expect(parseFindingStatus(undefined)).toBeNull();
  });

  it("only lets a review dismiss or reopen; resolving is the scan's", () => {
    expect(parseReviewStatus("dismissed")).toBe("dismissed");
    expect(parseReviewStatus("open")).toBe("open");
    expect(parseReviewStatus("resolved")).toBeNull();
  });
});
