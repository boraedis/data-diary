// Server-only geocoding wrapper — turns a place's free-text `address` into
// lat/lng. Same shape as src/lib/tmdb.ts: the API key is read from
// `GOOGLE_MAPS_API_KEY` at call time (never at module load, never
// client-side) via the Geocoding API's plain HTTP endpoint, no SDK needed.
//
// This deliberately does NOT mirror the legacy app's behavior of
// re-geocoding on every single place edit regardless of what changed —
// two different hardcoded API keys, one in new_place_form.js and a
// different one in places.js, both client-side-exposed, and both re-fired
// unconditionally (the `if (old_address != new_address)` short-circuit
// that would have skipped the redundant call was commented out). See
// geocodePlaceIfNeeded in src/lib/catalog-admin.ts for the "only when the
// address actually changed" gate that replaces that legacy bug.

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

function getApiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_MAPS_API_KEY is not set");
  }
  return key;
}

export type GeocodeResult = { lat: number; lng: number } | null;

/** Returns null (rather than throwing) when the address doesn't resolve to
 * a result — an unrecognized/partial address shouldn't block saving a
 * place, it should just leave lat/lng unset. Throws only on a genuine
 * request/API failure (bad key, network error, non-2xx), which the caller
 * should surface rather than silently swallow. */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const url = new URL(GEOCODE_URL);
  url.searchParams.set("address", trimmed);
  url.searchParams.set("key", getApiKey());

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Geocoding request failed (${res.status})`);
  }
  const data = (await res.json()) as {
    status: string;
    results: { geometry: { location: { lat: number; lng: number } } }[];
  };

  if (data.status === "ZERO_RESULTS") return null;
  if (data.status !== "OK") {
    throw new Error(`Geocoding failed: ${data.status}`);
  }
  const location = data.results[0]?.geometry?.location;
  if (!location) return null;
  return { lat: location.lat, lng: location.lng };
}
