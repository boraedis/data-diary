import { describe, expect, it } from "vitest";
import {
  GROUP_HEADER_HEIGHT,
  groupHeaderHeight,
  resolveHeaderLabel,
  resolveTileLabel,
  TILE_FONT_TIERS,
  type TileBox,
} from "./treemap";

const box = (width: number, height: number): TileBox => ({ x0: 0, y0: 0, x1: width, y1: height });

describe("resolveTileLabel", () => {
  it("uses the largest tier on a roomy tile, with the value underneath", () => {
    expect(resolveTileLabel(box(200, 100), "Alex Morgan", "AM", "120")).toEqual({
      lines: ["Alex Morgan"],
      size: TILE_FONT_TIERS[0],
      value: "120",
    });
  });

  it("drops the value line before shrinking the name", () => {
    // Tall enough for one 14px line (+ padding), not two.
    const label = resolveTileLabel(box(200, 26), "Alex Morgan", "AM", "120");
    expect(label).toEqual({ lines: ["Alex Morgan"], size: 14 });
  });

  it("wraps across two lines when the tile is too narrow for one", () => {
    const label = resolveTileLabel(box(60, 60), "Alex Morgan");
    expect(label?.lines).toEqual(["Alex", "Morgan"]);
  });

  it("falls back to the short name before giving up", () => {
    const label = resolveTileLabel(box(24, 20), "Alexandra Morgan-Whitfield", "AM");
    expect(label?.lines).toEqual(["AM"]);
  });

  it("prefers the full name at a smaller size over the short name at a larger one", () => {
    // Too narrow for "Alexandra" at 14px, wide enough at 10px.
    const label = resolveTileLabel(box(60, 20), "Alexandra", "A");
    expect(label?.lines).toEqual(["Alexandra"]);
    expect(label?.size).toBeLessThan(TILE_FONT_TIERS[0]);
  });

  it("hides the label on a tile too small for anything", () => {
    expect(resolveTileLabel(box(6, 6), "Alex Morgan", "AM", "3")).toBeNull();
  });
});

describe("groupHeaderHeight", () => {
  it("never gives the focused root a header", () => {
    expect(groupHeaderHeight(box(800, 600), 0)).toBe(0);
  });

  it("gives a roomy group a header", () => {
    expect(groupHeaderHeight(box(200, 200), 1)).toBe(GROUP_HEADER_HEIGHT);
  });

  it("skips the header on a group too narrow or too short to spend one", () => {
    expect(groupHeaderHeight(box(30, 200), 1)).toBe(0);
    expect(groupHeaderHeight(box(200, GROUP_HEADER_HEIGHT * 2), 1)).toBe(0);
  });
});

describe("resolveHeaderLabel", () => {
  it("shows the full name when it fits", () => {
    expect(resolveHeaderLabel(300, "University friends")).toBe("University friends");
  });

  it("uses the short name before truncating", () => {
    expect(resolveHeaderLabel(60, "University friends", "Uni")).toBe("Uni");
  });

  it("truncates with an ellipsis when there's no short name", () => {
    const label = resolveHeaderLabel(70, "University friends");
    expect(label?.endsWith("…")).toBe(true);
    expect(label!.length).toBeLessThan("University friends".length);
  });

  it("gives up on a sliver", () => {
    expect(resolveHeaderLabel(20, "University friends")).toBeNull();
  });
});
