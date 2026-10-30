import { describe, expect, it } from "vitest";
import {
  createHintStabilizer,
  lightingHints,
  luminanceStats,
  poseHints,
  visibleHints,
  type FramingHintId,
} from "@/lib/day-portraits/hints";
import { face, FRAME, GUIDE } from "@/lib/day-portraits/test-faces";

const hints = (options?: Parameters<typeof face>[0]) => poseHints(face(options), FRAME, GUIDE);

describe("poseHints", () => {
  it("has nothing to say about a well-framed face", () => {
    expect(hints()).toEqual([]);
  });

  it("does not depend on which mesh point is on which side of the picture", () => {
    expect(hints({ mirrored: true })).toEqual([]);
  });

  it("asks for a face that is too small to come closer, and one too big to back off", () => {
    expect(hints({ share: 0.5 })).toContain("too-far");
    expect(hints({ share: 1.25 })).toContain("too-close");
  });

  it("flags eyes off the eye line, whichever way", () => {
    expect(hints({ dy: GUIDE.ry * 0.3 })).toContain("off-line");
    expect(hints({ dy: -GUIDE.ry * 0.3 })).toContain("off-line");
    expect(hints({ dy: GUIDE.ry * 0.05 })).not.toContain("off-line");
  });

  it("flags a face off to one side", () => {
    expect(hints({ dx: GUIDE.rx * 0.5 })).toContain("off-centre");
    expect(hints({ dx: -GUIDE.rx * 0.5 })).toContain("off-centre");
    expect(hints({ dx: GUIDE.rx * 0.1 })).not.toContain("off-centre");
  });

  it("flags a tilted head, measured in pixels rather than frame fractions", () => {
    expect(hints({ rollDegrees: 8 })).toContain("tilted");
    expect(hints({ rollDegrees: -8 })).toContain("tilted");
    expect(hints({ rollDegrees: 5 })).toContain("tilted");
    expect(hints({ rollDegrees: 2 })).not.toContain("tilted");
  });

  it("flags a turned head by the nose leaving the middle of the face", () => {
    expect(hints({ noseShift: 0.15 })).toContain("turned");
    expect(hints({ noseShift: -0.15 })).toContain("turned");
    expect(hints({ noseShift: 0.03 })).not.toContain("turned");
  });

  it("reports several problems at once", () => {
    const found = hints({ share: 0.5, rollDegrees: 8, noseShift: 0.2 });
    expect(found).toEqual(expect.arrayContaining(["too-far", "tilted", "turned"]));
  });
});

function pixels(width: number, height: number, luma: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = luma(x, y);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

const WHOLE = { x0: 0, y0: 0, x1: 10, y1: 10 };

describe("lighting", () => {
  it("accepts an evenly, moderately lit scene", () => {
    const stats = luminanceStats(pixels(10, 10, () => 128), 10, 10, WHOLE);
    expect(stats?.mean).toBeCloseTo(128, 0);
    expect(lightingHints(stats!)).toEqual([]);
  });

  it("flags a dark scene", () => {
    expect(lightingHints(luminanceStats(pixels(10, 10, () => 30), 10, 10, WHOLE)!)).toEqual(["too-dark"]);
  });

  it("flags a washed-out scene", () => {
    expect(lightingHints(luminanceStats(pixels(10, 10, () => 230), 10, 10, WHOLE)!)).toEqual(["too-bright"]);
  });

  it("flags blown highlights even when the average looks fine", () => {
    // A bright window half the box: the mean is mid-range, the clipping is not.
    const stats = luminanceStats(pixels(10, 10, (x) => (x < 5 ? 255 : 100)), 10, 10, WHOLE)!;
    expect(stats.clippedShare).toBeCloseTo(0.5);
    expect(lightingHints(stats)).toEqual(["too-bright"]);
  });

  it("flags light from one side", () => {
    const stats = luminanceStats(pixels(10, 10, (x) => (x < 5 ? 180 : 90)), 10, 10, WHOLE)!;
    expect(stats.leftMean).toBeGreaterThan(stats.rightMean);
    expect(lightingHints(stats)).toEqual(["uneven-light"]);
  });

  it("tolerates a mild difference between the sides", () => {
    const stats = luminanceStats(pixels(10, 10, (x) => (x < 5 ? 140 : 115)), 10, 10, WHOLE)!;
    expect(lightingHints(stats)).toEqual([]);
  });

  it("does not call a dark room uneven as well", () => {
    const stats = luminanceStats(pixels(10, 10, (x) => (x < 5 ? 40 : 10)), 10, 10, WHOLE)!;
    expect(lightingHints(stats)).toEqual(["too-dark"]);
  });

  it("measures only the box it is given", () => {
    // Bright background, dark middle: the box over the middle sees dark.
    const data = pixels(10, 10, (x, y) => (x >= 3 && x < 7 && y >= 3 && y < 7 ? 20 : 240));
    const stats = luminanceStats(data, 10, 10, { x0: 3, y0: 3, x1: 7, y1: 7 })!;
    expect(stats.mean).toBeCloseTo(20, 0);
  });

  it("clamps a box that spills off the buffer and rejects an empty one", () => {
    const data = pixels(10, 10, () => 100);
    expect(luminanceStats(data, 10, 10, { x0: -5, y0: -5, x1: 50, y1: 50 })?.mean).toBeCloseTo(100, 0);
    expect(luminanceStats(data, 10, 10, { x0: 4, y0: 4, x1: 4, y1: 9 })).toBeNull();
  });
});

describe("createHintStabilizer", () => {
  it("ignores a blip shorter than the show threshold", () => {
    const s = createHintStabilizer(4, 3);
    expect(s.update(["tilted"])).toEqual([]);
    expect(s.update(["tilted"])).toEqual([]);
    expect(s.update([])).toEqual([]);
    expect(s.update(["tilted"])).toEqual([]);
  });

  it("shows a hint once it has held, and clears it once it has stayed gone", () => {
    const s = createHintStabilizer(4, 3);
    for (let i = 0; i < 3; i++) expect(s.update(["tilted"])).toEqual([]);
    expect(s.update(["tilted"])).toEqual(["tilted"]);
    expect(s.update([])).toEqual(["tilted"]);
    expect(s.update([])).toEqual(["tilted"]);
    expect(s.update([])).toEqual([]);
  });

  it("keeps a shown hint through a single good frame", () => {
    const s = createHintStabilizer(2, 3);
    s.update(["turned"]);
    expect(s.update(["turned"])).toEqual(["turned"]);
    expect(s.update([])).toEqual(["turned"]);
    expect(s.update(["turned"])).toEqual(["turned"]);
    expect(s.update([])).toEqual(["turned"]);
    expect(s.update([])).toEqual(["turned"]);
    expect(s.update([])).toEqual([]);
  });

  it("orders what it returns by importance, not by arrival", () => {
    const s = createHintStabilizer(1, 3);
    s.update(["too-dark"]);
    expect(s.update(["too-dark", "too-far"])).toEqual(["too-far", "too-dark"]);
  });

  it("forgets everything on reset", () => {
    const s = createHintStabilizer(1, 3);
    expect(s.update(["tilted"])).toEqual(["tilted"]);
    s.reset();
    expect(s.update([])).toEqual([]);
  });
});

describe("visibleHints", () => {
  const all: FramingHintId[] = ["too-far", "off-line", "tilted", "too-dark"];

  it("shows at most the two most important", () => {
    expect(visibleHints(all)).toEqual(["too-far", "off-line"]);
  });

  it("shows nothing when there is nothing to fix", () => {
    expect(visibleHints([])).toEqual([]);
  });

  it("lets only the light join a missing face", () => {
    expect(visibleHints(["no-face", "tilted", "too-dark"])).toEqual(["no-face", "too-dark"]);
    expect(visibleHints(["no-face", "tilted"])).toEqual(["no-face"]);
  });
});
