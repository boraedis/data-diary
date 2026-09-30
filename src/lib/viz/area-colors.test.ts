import { describe, expect, it } from "vitest";
import { AREA_COLORS, AREA_OVERFLOW_COLOR, areaColorForRank, areaColorsFromRanks } from "@/lib/viz/area-colors";

describe("areaColorForRank", () => {
  it("gives the top ten their own colours and everything else the overflow grey", () => {
    expect(new Set(AREA_COLORS.map((_, i) => areaColorForRank(i))).size).toBe(10);
    expect(areaColorForRank(10)).toBe(AREA_OVERFLOW_COLOR);
  });
});

describe("areaColorsFromRanks", () => {
  it("keys metros by name and municipalities by place id, top ten only", () => {
    const colors = areaColorsFromRanks([
      { key: "metro:3", label: "Washington DC", rank: 0 },
      { key: "place:42", label: "Bursa", rank: 1 },
      { key: "place:43", label: "Izmir", rank: 10 },
    ]);
    expect(colors.metros).toEqual({ "Washington DC": AREA_COLORS[0] });
    expect(colors.places).toEqual({ "42": AREA_COLORS[1] });
  });
});
