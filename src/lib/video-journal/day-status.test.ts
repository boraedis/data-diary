import { describe, expect, it } from "vitest";
import { summarizeDayVideo, type DayVideoRow } from "@/lib/video-journal/day-status";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const row = (overrides: Partial<DayVideoRow>): DayVideoRow => ({
  status: "ready",
  finalized: false,
  logNumber: null,
  transcriptionStartedAt: null,
  ...overrides,
});

describe("summarizeDayVideo", () => {
  it("says nothing for a day without recordings", () => {
    expect(summarizeDayVideo([], NOW)).toBeNull();
  });

  it("shows the finalized log's number once the day is settled", () => {
    expect(summarizeDayVideo([row({ finalized: true, logNumber: 12 })], NOW)).toEqual({
      text: "Video log #12",
      tone: "muted",
    });
  });

  it("asks to finalize ready recordings, even after an earlier finalize", () => {
    expect(summarizeDayVideo([row({ finalized: true, logNumber: 12 }), row({}), row({})], NOW)).toEqual({
      text: "2 recordings to finalize",
      tone: "attention",
    });
  });

  it("shows progress while uploading or transcribing", () => {
    expect(summarizeDayVideo([row({ status: "uploading" })], NOW)?.text).toBe("Uploading video…");
    expect(summarizeDayVideo([row({ status: "uploaded" })], NOW)?.text).toBe("Transcribing…");
    expect(
      summarizeDayVideo([row({ status: "transcribing", transcriptionStartedAt: new Date(NOW - 60_000) })], NOW),
    ).toEqual({ text: "Transcribing…", tone: "progress" });
  });

  it("surfaces a failure above everything else", () => {
    expect(summarizeDayVideo([row({ finalized: true, logNumber: 3 }), row({ status: "failed" })], NOW)).toEqual({
      text: "Transcription failed. Retry in Record",
      tone: "error",
    });
  });

  it("treats an abandoned transcription as failed", () => {
    const stale = row({ status: "transcribing", transcriptionStartedAt: new Date(NOW - 60 * 60 * 1000) });
    expect(summarizeDayVideo([stale, row({ status: "failed" })], NOW)?.text).toBe("2 transcriptions failed. Retry in Record");
  });
});
