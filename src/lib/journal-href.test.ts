import { describe, expect, it } from "vitest";
import { journalHref } from "@/lib/journal-href";

describe("journalHref", () => {
  it("is plain /journal with nothing set", () => {
    expect(journalHref()).toBe("/journal");
    expect(journalHref({ search: "  ", page: 1, video: false })).toBe("/journal");
  });

  it("carries search, year, the video filter and page", () => {
    expect(journalHref({ search: "birthday", year: "2026", video: true, page: 3 })).toBe(
      "/journal?q=birthday&year=2026&video=1&page=3",
    );
  });

  it("encodes the search term", () => {
    expect(journalHref({ search: "a&b c" })).toBe("/journal?q=a%26b+c");
  });
});
