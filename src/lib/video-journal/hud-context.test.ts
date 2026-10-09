import { describe, expect, it } from "vitest";
import { parseGoogleReverseGeocode, parseOpenMeteoCurrent } from "@/lib/video-journal/hud-context";

describe("parseGoogleReverseGeocode", () => {
  it("reads city, state and country", () => {
    const body = {
      results: [
        {
          address_components: [
            { long_name: "New York", short_name: "New York", types: ["locality", "political"] },
            { long_name: "New York", short_name: "NY", types: ["administrative_area_level_1", "political"] },
            { long_name: "United States", short_name: "US", types: ["country", "political"] },
          ],
        },
      ],
    };
    expect(parseGoogleReverseGeocode(body)).toEqual({
      city: "New York",
      region: "NY",
      country: "US",
      countryName: "United States",
    });
  });

  it("falls back to postal_town when there's no locality", () => {
    const body = {
      results: [
        {
          address_components: [
            { long_name: "London", short_name: "London", types: ["postal_town"] },
            { long_name: "England", short_name: "England", types: ["administrative_area_level_1"] },
            { long_name: "United Kingdom", short_name: "GB", types: ["country"] },
          ],
        },
      ],
    };
    expect(parseGoogleReverseGeocode(body)?.city).toBe("London");
  });

  it("is null with no results", () => {
    expect(parseGoogleReverseGeocode({ results: [], status: "ZERO_RESULTS" })).toBeNull();
    expect(parseGoogleReverseGeocode(null)).toBeNull();
  });
});

describe("parseOpenMeteoCurrent", () => {
  it("reads current conditions", () => {
    const body = { current: { temperature_2m: 18.4, weather_code: 2, wind_speed_10m: 9.1, is_day: 0 } };
    expect(parseOpenMeteoCurrent(body)).toEqual({ tempC: 18.4, code: 2, windKph: 9.1, isDay: false });
  });

  it("is null when fields are missing", () => {
    expect(parseOpenMeteoCurrent({ current: { temperature_2m: 18 } })).toBeNull();
    expect(parseOpenMeteoCurrent({})).toBeNull();
  });
});
