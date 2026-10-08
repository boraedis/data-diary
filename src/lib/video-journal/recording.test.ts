import { describe, expect, it } from "vitest";
import {
  classifyRecorderError,
  effectiveMbps,
  extensionForMimeType,
  formatBytes,
  formatElapsed,
  pickRecordingMimeType,
} from "@/lib/video-journal/recording";

describe("pickRecordingMimeType", () => {
  it("prefers MP4 with explicit codecs when supported", () => {
    expect(pickRecordingMimeType(() => true)).toBe("video/mp4;codecs=avc1,mp4a.40.2");
  });

  it("takes plain video/mp4 when that's all the engine claims (Safari)", () => {
    expect(pickRecordingMimeType((t) => t === "video/mp4")).toBe("video/mp4");
  });

  it("falls back to WebM when no MP4 variant is supported (older Chrome)", () => {
    expect(pickRecordingMimeType((t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
  });

  it("treats a throwing isTypeSupported as unsupported and keeps looking", () => {
    const supported = (t: string) => {
      if (t.includes("codecs")) throw new Error("cannot parse");
      return t === "video/webm";
    };
    expect(pickRecordingMimeType(supported)).toBe("video/webm");
  });

  it("returns null when nothing is supported", () => {
    expect(pickRecordingMimeType(() => false)).toBeNull();
  });
});

describe("extensionForMimeType", () => {
  it.each([
    ["video/mp4", "mp4"],
    ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["VIDEO/WEBM", "webm"],
  ])("%s -> %s", (mime, ext) => {
    expect(extensionForMimeType(mime)).toBe(ext);
  });
});

describe("formatElapsed", () => {
  it.each([
    [0, "0:00"],
    [999, "0:00"],
    [7_000, "0:07"],
    [754_000, "12:34"],
    [3_723_000, "1:02:03"],
    [-5, "0:00"],
  ])("%d ms -> %s", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});

describe("formatBytes", () => {
  it.each([
    [840_000, "840 KB"],
    [12_400_000, "12.4 MB"],
    [1_210_000_000, "1.21 GB"],
  ])("%d -> %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("effectiveMbps", () => {
  it("computes megabits per second", () => {
    // 7.5 MB over 60 s = 1 Mbps.
    expect(effectiveMbps(7_500_000, 60_000)).toBeCloseTo(1);
  });

  it("is null for sub-second recordings", () => {
    expect(effectiveMbps(10_000, 500)).toBeNull();
  });
});

describe("classifyRecorderError", () => {
  it.each([
    ["NotAllowedError", "permission"],
    ["SecurityError", "permission"],
    ["NotFoundError", "no-device"],
    ["NotReadableError", "in-use"],
    ["NotSupportedError", "unsupported"],
    ["SomethingElse", "unknown"],
  ])("%s -> %s", (name, kind) => {
    expect(classifyRecorderError({ name })).toBe(kind);
  });

  it("handles non-error throwables", () => {
    expect(classifyRecorderError("boom")).toBe("unknown");
    expect(classifyRecorderError(null)).toBe("unknown");
  });
});
