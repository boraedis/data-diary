import { describe, expect, it } from "vitest";
import { missingParts, partCount, partRange, UPLOAD_PART_SIZE } from "@/lib/video-journal/upload-plan";

const P = UPLOAD_PART_SIZE;

describe("partCount", () => {
  it.each([
    [0, 1],
    [1, 1],
    [P, 1],
    [P + 1, 2],
    [3 * P, 3],
    [3 * P + 5, 4],
  ])("%d bytes -> %d parts", (size, parts) => {
    expect(partCount(size)).toBe(parts);
  });
});

describe("partRange", () => {
  it("covers the file exactly, with every part but the last the same size", () => {
    const size = 2 * P + 123;
    const ranges = [1, 2, 3].map((n) => partRange(n, size));
    expect(ranges).toEqual([
      [0, P],
      [P, 2 * P],
      [2 * P, 2 * P + 123],
    ]);
  });

  it("gives a single part the whole file", () => {
    expect(partRange(1, 500)).toEqual([0, 500]);
  });
});

describe("missingParts", () => {
  it("lists every part when nothing is uploaded", () => {
    expect(missingParts(3 * P, [])).toEqual([1, 2, 3]);
  });

  it("skips parts R2 already has", () => {
    expect(missingParts(4 * P, [1, 3])).toEqual([2, 4]);
  });

  it("is empty once everything is there", () => {
    expect(missingParts(2 * P, [2, 1])).toEqual([]);
  });
});
