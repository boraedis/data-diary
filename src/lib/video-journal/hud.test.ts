import { describe, expect, it } from "vitest";
import {
  countryDisplayName,
  diaryStatLines,
  formatCoords,
  formatHudClock,
  formatPlace,
  formatSleep,
  formatWeather,
  sanitizeHudSnapshot,
  weatherLabel,
} from "@/lib/video-journal/hud";

const STATS = {
  sleepTime: "23:40",
  wakeTime: "07:05",
  wakeCrossedMidnight: true,
  coffees: 2,
  distanceWalkedKm: 6.42,
  happiness: 74,
};

describe("formatting", () => {
  it("weather", () => {
    expect(formatWeather({ tempC: 18.4, code: 2, windKph: 9.2, isDay: true })).toBe("18°C PARTLY CLOUDY");
    expect(weatherLabel(1234)).toBe("WEATHER");
  });

  it("coordinates", () => {
    expect(formatCoords(40.712776, -74.005974)).toBe("40.7128°N 74.0060°W");
    expect(formatCoords(-33.8688, 151.2093)).toBe("33.8688°S 151.2093°E");
  });

  it("place", () => {
    const base = { lat: 0, lng: 0, accuracyM: null };
    expect(formatPlace({ ...base, city: "New York", region: "NY", country: "US", countryName: "United States" })).toBe(
      "New York, NY, USA",
    );
    // A region that isn't a two-letter code (or a non-US region) is left out.
    expect(formatPlace({ ...base, city: "Seattle", region: "Washington", country: "US", countryName: null })).toBe(
      "Seattle, USA",
    );
    expect(formatPlace({ ...base, city: "Toronto", region: "ON", country: "CA", countryName: "Canada" })).toBe(
      "Toronto, Canada",
    );
    expect(formatPlace({ ...base, city: "Prague", region: null, country: "CZ", countryName: "Czechia" })).toBe(
      "Prague, Czechia",
    );
    expect(formatPlace({ ...base, city: "Paris", region: null, country: "FR", countryName: null })).toBe("Paris, FR");
    expect(formatPlace({ ...base, city: null, region: null, country: "IT", countryName: "Italy" })).toBe("Italy");
    expect(formatPlace({ ...base, city: null, region: null, country: null, countryName: null })).toBeNull();
  });

  it("clock in the recording's timezone, 24-hour", () => {
    expect(formatHudClock(new Date("2026-10-09T01:47:05Z"), "America/New_York")).toBe("THU 8 OCT 2026 · 21:47:05 EDT");
    expect(formatHudClock(new Date("2026-10-09T01:47:05Z"), null)).toBe("FRI 9 OCT 2026 · 01:47:05 UTC");
  });
});

describe("countryDisplayName", () => {
  it.each([
    ["US", "United States", "USA"],
    ["GB", "United Kingdom", "UK"],
    ["AE", "United Arab Emirates", "UAE"],
    ["TR", "Türkiye", "Turkey"],
    ["CZ", "Czechia", "Czechia"],
    ["FR", "France", "France"],
    ["gb", null, "UK"],
    [null, "Somewhere", "Somewhere"],
  ])("%s / %s -> %s", (code, name, shown) => {
    expect(countryDisplayName(code, name)).toBe(shown);
  });
});

describe("formatSleep", () => {
  it("handles waking after midnight", () => {
    expect(formatSleep(STATS)).toBe("SLEEP 7H 25M");
  });

  it("is null when incomplete or implausible", () => {
    expect(formatSleep({ ...STATS, wakeTime: null })).toBeNull();
    expect(formatSleep({ ...STATS, wakeCrossedMidnight: false })).toBeNull();
  });
});

describe("diaryStatLines", () => {
  it("shows what's logged, in order", () => {
    expect(diaryStatLines(STATS)).toEqual(["SLEEP 7H 25M", "COFFEE 2", "HAPPINESS 74"]);
  });

  it("hides what isn't logged yet", () => {
    expect(diaryStatLines({ ...STATS, sleepTime: null, happiness: null })).toEqual(["COFFEE 2"]);
    expect(diaryStatLines(null)).toEqual([]);
  });
});

describe("sanitizeHudSnapshot", () => {
  const good = {
    capturedAt: "2026-10-09T01:47:05.000Z",
    timeZone: "America/New_York",
    location: {
      lat: 40.7,
      lng: -74,
      accuracyM: 12,
      city: "New York",
      region: "NY",
      country: "US",
      countryName: "United States",
    },
    weather: { tempC: 18, code: 2, windKph: 9, isDay: true },
  };

  it("keeps a well-formed snapshot", () => {
    expect(sanitizeHudSnapshot(good)).toEqual(good);
  });

  it("drops bad parts without rejecting the rest", () => {
    const result = sanitizeHudSnapshot({ ...good, location: { lat: 999, lng: 0 }, weather: { tempC: "hot" } });
    expect(result).toEqual({ ...good, location: null, weather: null });
  });

  it("rejects a snapshot without a valid time", () => {
    expect(sanitizeHudSnapshot({ ...good, capturedAt: "nope" })).toBeNull();
    expect(sanitizeHudSnapshot("x")).toBeNull();
  });
});
