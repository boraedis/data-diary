import { describe, expect, it } from "vitest";
import { buildJournalEntry, formatRecordedAt } from "@/lib/video-journal/journal-entry";

// 2026-10-09 01:47 UTC = Thu 8 Oct, 9:47 PM in New York (EDT).
const AT = new Date("2026-10-09T01:47:57Z");

describe("formatRecordedAt", () => {
  it("uses the recording device's timezone", () => {
    expect(formatRecordedAt(AT, "America/New_York")).toBe("Thu 8 Oct 2026, 9:47 PM EDT");
  });

  it("falls back to UTC when the timezone is unknown", () => {
    expect(formatRecordedAt(AT, null)).toBe("Fri 9 Oct 2026, 1:47 AM UTC");
    expect(formatRecordedAt(AT, "Not/AZone")).toBe("Fri 9 Oct 2026, 1:47 AM UTC");
  });
});

describe("buildJournalEntry", () => {
  it("renders the mission-log header above the transcript", () => {
    expect(
      buildJournalEntry({
        id: "5cea423f-df7d-4994-b90e-7b110c6bdd72",
        logNumber: 12,
        recordedAt: AT,
        recordedTz: "America/New_York",
        durationMs: 125_000,
        transcript: "  So today was mostly about getting the upload working.\n",
      }),
    ).toBe(
      [
        "VIDEO LOG #12",
        "Date:     Thu 8 Oct 2026, 9:47 PM EDT",
        "Length:   2:05",
        "Ref:      5cea423f",
        "",
        "So today was mostly about getting the upload working.",
      ].join("\n"),
    );
  });

  it("adds Location and Weather lines from the HUD snapshot", () => {
    const entry = buildJournalEntry({
      id: "5cea423f-df7d-4994-b90e-7b110c6bdd72",
      logNumber: 12,
      recordedAt: AT,
      recordedTz: "America/New_York",
      durationMs: 125_000,
      transcript: "Hi.",
      hud: {
        capturedAt: AT.toISOString(),
        timeZone: "America/New_York",
        location: {
          lat: 40.712776,
          lng: -74.005974,
          accuracyM: 10,
          city: "New York",
          region: "NY",
          country: "US",
          countryName: "United States",
        },
        weather: { tempC: 18.4, code: 2, windKph: 9.2, isDay: false },
      },
    });
    expect(entry.split("\n").slice(0, 6)).toEqual([
      "VIDEO LOG #12",
      "Date:     Thu 8 Oct 2026, 9:47 PM EDT",
      "Length:   2:05",
      "Location: New York, USA (40.7128°N 74.0060°W)",
      "Weather:  18°C, partly cloudy",
      "Ref:      5cea423f",
    ]);
  });

  it("omits the number when one hasn't been assigned", () => {
    const entry = buildJournalEntry({
      id: "5cea423f-df7d-4994-b90e-7b110c6bdd72",
      logNumber: null,
      recordedAt: AT,
      recordedTz: null,
      durationMs: 3000,
      transcript: "Hi.",
    });
    expect(entry.split("\n")[0]).toBe("VIDEO LOG");
  });
});
