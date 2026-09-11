import { describe, expect, it } from "vitest";
import { escapeLikePattern, splitOnMatches } from "@/lib/journal";

describe("escapeLikePattern", () => {
  it("leaves ordinary text alone", () => {
    expect(escapeLikePattern("birthday dinner")).toBe("birthday dinner");
  });

  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
  });

  it("escapes backslashes without double-escaping its own escapes", () => {
    expect(escapeLikePattern("C:\\path")).toBe("C:\\\\path");
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });
});

describe("splitOnMatches", () => {
  it("returns one unmatched segment for an empty query", () => {
    expect(splitOnMatches("a good day", "")).toEqual([{ text: "a good day", match: false }]);
    expect(splitOnMatches("a good day", "   ")).toEqual([{ text: "a good day", match: false }]);
  });

  it("splits around a match", () => {
    expect(splitOnMatches("a good day", "good")).toEqual([
      { text: "a ", match: false },
      { text: "good", match: true },
      { text: " day", match: false },
    ]);
  });

  it("matches case-insensitively but preserves the original casing", () => {
    expect(splitOnMatches("Good day", "good")).toEqual([
      { text: "Good", match: true },
      { text: " day", match: false },
    ]);
  });

  it("finds every occurrence", () => {
    expect(splitOnMatches("run, run, run", "run")).toEqual([
      { text: "run", match: true },
      { text: ", ", match: false },
      { text: "run", match: true },
      { text: ", ", match: false },
      { text: "run", match: true },
    ]);
  });

  it("handles a match at the start and end without empty segments", () => {
    expect(splitOnMatches("abc", "abc")).toEqual([{ text: "abc", match: true }]);
  });

  it("treats the query as literal text, not a regex", () => {
    expect(splitOnMatches("cost (approx) $5", "(approx)")).toEqual([
      { text: "cost ", match: false },
      { text: "(approx)", match: true },
      { text: " $5", match: false },
    ]);
    expect(splitOnMatches("a.b", "a.b")).toEqual([{ text: "a.b", match: true }]);
    expect(splitOnMatches("axb", "a.b")).toEqual([{ text: "axb", match: false }]);
  });

  it("returns the text unhighlighted when no match is found", () => {
    expect(splitOnMatches("a good day", "zzz")).toEqual([{ text: "a good day", match: false }]);
  });

  it("skips highlighting rather than misaligning when lowercasing changes length", () => {
    // "İ".toLowerCase() is two code units, which would shift every offset
    // found in the lowercased copy.
    const text = "İstanbul trip";
    expect(splitOnMatches(text, "trip")).toEqual([{ text, match: false }]);
  });
});
