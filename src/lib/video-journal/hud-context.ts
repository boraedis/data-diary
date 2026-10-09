// Server-side lookups behind the mission HUD (#599): turn the device's
// live coordinates into "City, Country" and the current weather, once,
// when recording starts. Always the device's own GPS fix, never the
// diary's saved places (owner's call on #599). Server-only: reverse geocoding uses the
// GOOGLE_MAPS_API_KEY the app already has (read at call time, never sent to
// the browser).
//
// Reverse geocoding here is a separate use from src/lib/geocode.ts, which
// deliberately only goes address → lat/lng for places (#302: no address
// reconstruction from coordinates). This only labels where a video was
// filmed and is never written back to a place.
//
// Weather comes from Open-Meteo: free, no key, and current conditions by
// coordinates in one call. Both lookups are best-effort with short
// timeouts. Each failure just leaves its part of the HUD empty.

const LOOKUP_TIMEOUT_MS = 5000;

export type ReverseGeocode = {
  city: string | null;
  region: string | null;
  country: string | null;
  countryName: string | null;
};
export type CurrentWeather = { tempC: number; code: number; windKph: number; isDay: boolean };

type AddressComponent = { long_name?: string; short_name?: string; types?: string[] };

/** Picks city / state / country out of a Google Geocoding response. Pure,
 * for tests. "City" falls back through the types Google uses for places
 * without a `locality` (London's postal_town, NYC boroughs' sublocality,
 * rural areas' county). */
export function parseGoogleReverseGeocode(body: unknown): ReverseGeocode | null {
  const results = (body as { results?: { address_components?: AddressComponent[] }[] })?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const components = results.flatMap((r) => r.address_components ?? []);
  const find = (type: string) => components.find((c) => c.types?.includes(type));
  const city =
    find("locality")?.long_name ??
    find("postal_town")?.long_name ??
    find("sublocality")?.long_name ??
    find("administrative_area_level_2")?.long_name ??
    null;
  return {
    city,
    region: find("administrative_area_level_1")?.short_name ?? null,
    country: find("country")?.short_name ?? null,
    countryName: find("country")?.long_name ?? null,
  };
}

/** Current conditions out of an Open-Meteo forecast response. Pure. */
export function parseOpenMeteoCurrent(body: unknown): CurrentWeather | null {
  const c = (body as { current?: Record<string, unknown> })?.current;
  if (!c) return null;
  const tempC = c.temperature_2m;
  const code = c.weather_code;
  const windKph = c.wind_speed_10m;
  if (typeof tempC !== "number" || typeof code !== "number" || typeof windKph !== "number") return null;
  return { tempC, code, windKph, isDay: c.is_day === 1 };
}

export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocode | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ latlng: `${lat},${lng}`, key });
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return parseGoogleReverseGeocode(await res.json());
}

export async function currentWeather(lat: number, lng: number): Promise<CurrentWeather | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: "temperature_2m,weather_code,wind_speed_10m,is_day",
    wind_speed_unit: "kmh",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return parseOpenMeteoCurrent(await res.json());
}

/** Both lookups in parallel; either can fail on its own. */
export async function lookupHudContext(
  lat: number,
  lng: number,
): Promise<{ place: ReverseGeocode | null; weather: CurrentWeather | null }> {
  const [place, weather] = await Promise.all([
    reverseGeocode(lat, lng).catch(() => null),
    currentWeather(lat, lng).catch(() => null),
  ]);
  return { place, weather };
}
