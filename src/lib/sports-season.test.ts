import { describe, expect, it } from "vitest";
import { compareSeasonsNewestFirst, latestSeasonName } from "@/lib/sports-season";

describe("compareSeasonsNewestFirst", () => {
  it("puts the later year first across both name formats", () => {
    const sorted = ["2024-25", "2026-27", "2025-26", "2024"].sort(compareSeasonsNewestFirst);
    expect(sorted).toEqual(["2026-27", "2025-26", "2024-25", "2024"]);
  });

  it("breaks a same-year tie so the fuller season comes after the bare year", () => {
    expect(["2025", "2025-26"].sort(compareSeasonsNewestFirst)).toEqual(["2025-26", "2025"]);
  });

  it("sorts names with no leading year last", () => {
    expect(["Spring", "2024-25"].sort(compareSeasonsNewestFirst)).toEqual(["2024-25", "Spring"]);
  });
});

describe("latestSeasonName", () => {
  it("returns the most recent season regardless of input order", () => {
    expect(latestSeasonName(["2024-25", "2025-26", "2023-24"])).toBe("2025-26");
  });

  it("returns null when a league has no seasons", () => {
    expect(latestSeasonName([])).toBeNull();
  });
});
