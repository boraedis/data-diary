import { describe, expect, it } from "vitest";
import { UPLOAD_PART_SIZE } from "@/lib/video-journal/upload-plan";
import { validatePartNumbers, validateStartUpload } from "@/lib/video-journal/video-log-types";

const valid = {
  id: "3F2504E0-4F89-41D3-9A0C-0305E82C3301",
  date: "2026-10-08",
  mimeType: "video/mp4;codecs=avc1,mp4a.40.2",
  sizeBytes: 12_345_678,
  durationMs: 95_000,
  recordedAt: "2026-10-08T21:14:03.120Z",
};

describe("validateStartUpload", () => {
  it("accepts a well-formed start and lowercases the id", () => {
    const result = validateStartUpload(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe("3f2504e0-4f89-41d3-9a0c-0305e82c3301");
  });

  it.each([
    ["video/mp4"],
    ["video/webm;codecs=vp9,opus"],
    ["video/webm; codecs=vp8,opus"],
  ])("accepts mime type %s", (mimeType) => {
    expect(validateStartUpload({ ...valid, mimeType }).ok).toBe(true);
  });

  it.each([
    ["id", "not-a-uuid"],
    ["date", "2026-02-30"],
    ["mimeType", "text/html"],
    ["mimeType", "video/mp4<script>"],
    ["sizeBytes", 0],
    ["sizeBytes", 1.5],
    ["sizeBytes", 30_000_000_000],
    ["durationMs", -1],
    ["recordedAt", "yesterday"],
  ])("rejects a bad %s (%j)", (field, value) => {
    expect(validateStartUpload({ ...valid, [field]: value }).ok).toBe(false);
  });
});

describe("validateStartUpload recordedTz", () => {
  it("keeps a real IANA timezone", () => {
    const result = validateStartUpload({ ...valid, recordedTz: "America/New_York" });
    expect(result.ok && result.value.recordedTz).toBe("America/New_York");
  });

  it.each([[undefined], [null], ["Not/AZone"], [42]])("drops %j rather than rejecting the upload", (recordedTz) => {
    const result = validateStartUpload({ ...valid, recordedTz });
    expect(result.ok && result.value.recordedTz).toBeNull();
  });
});

describe("validatePartNumbers", () => {
  const size = 3 * UPLOAD_PART_SIZE;

  it("dedupes and sorts", () => {
    expect(validatePartNumbers({ partNumbers: [3, 1, 3] }, size)).toEqual({ ok: true, value: [1, 3] });
  });

  it.each([[[]], [[0]], [[4]], [[1.5]], [["1"]]])("rejects %j", (partNumbers) => {
    expect(validatePartNumbers({ partNumbers }, size).ok).toBe(false);
  });

  it("caps a single request at 100 parts", () => {
    const many = Array.from({ length: 101 }, (_, i) => i + 1);
    expect(validatePartNumbers({ partNumbers: many }, 200 * UPLOAD_PART_SIZE).ok).toBe(false);
  });
});
