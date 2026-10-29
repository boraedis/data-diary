import { describe, expect, it } from "vitest";
import { GUIDE_HEIGHT_SHARE, portraitGuide } from "@/lib/day-portraits/guide";

describe("portraitGuide", () => {
  it("centres the oval horizontally and sizes it from the frame height", () => {
    const g = portraitGuide(1920, 1080);
    expect(g.cx).toBe(960);
    expect(g.ry).toBeCloseTo((1080 * GUIDE_HEIGHT_SHARE) / 2);
    expect(g.rx).toBeLessThan(g.ry);
  });

  it("puts the eye line inside the oval, above its centre", () => {
    const g = portraitGuide(1920, 1080);
    expect(g.eyeY).toBeLessThan(g.cy);
    expect(g.eyeY).toBeGreaterThan(g.cy - g.ry);
  });

  it("keeps the oval inside a narrow portrait frame", () => {
    const g = portraitGuide(480, 1080);
    expect(g.cx - g.rx).toBeGreaterThanOrEqual(0);
    expect(g.cx + g.rx).toBeLessThanOrEqual(480);
  });

  it("keeps the oval inside the frame vertically", () => {
    const g = portraitGuide(1920, 1080);
    expect(g.cy - g.ry).toBeGreaterThanOrEqual(0);
    expect(g.cy + g.ry).toBeLessThanOrEqual(1080);
  });
});
