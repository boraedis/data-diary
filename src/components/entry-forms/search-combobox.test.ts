import { describe, expect, it } from "vitest";
import { dropdownPosition } from "@/components/entry-forms/search-combobox";

// The width rules from #563: a narrow trigger must not make a narrow list.

describe("dropdownPosition", () => {
  it("widens past a narrow trigger and sits just below it", () => {
    expect(dropdownPosition({ left: 20, bottom: 100, width: 60 }, 1200)).toEqual({ top: 104, left: 20, width: 288 });
  });

  it("keeps a wide trigger's own width", () => {
    expect(dropdownPosition({ left: 20, bottom: 100, width: 500 }, 1200).width).toBe(500);
  });

  it("shifts left instead of overflowing the right edge", () => {
    const pos = dropdownPosition({ left: 1100, bottom: 0, width: 60 }, 1200);
    expect(pos.left + pos.width).toBe(1200 - 8);
  });

  it("clamps to the viewport on a phone narrower than the minimum", () => {
    expect(dropdownPosition({ left: 100, bottom: 0, width: 80 }, 280)).toEqual({ top: 4, left: 8, width: 264 });
  });
});
