import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geocodeAddress } from "@/lib/geocode";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("geocodeAddress", () => {
  it("returns null for a blank address without calling fetch", async () => {
    const fetchMock = mockFetchOnce({ status: "OK", results: [] });
    expect(await geocodeAddress("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns lat/lng on a successful match", async () => {
    mockFetchOnce({ status: "OK", results: [{ geometry: { location: { lat: 33.749, lng: -84.388 } } }] });
    expect(await geocodeAddress("Atlanta, GA")).toEqual({ lat: 33.749, lng: -84.388 });
  });

  it("returns null (not a throw) for ZERO_RESULTS", async () => {
    mockFetchOnce({ status: "ZERO_RESULTS", results: [] });
    expect(await geocodeAddress("asdkfjaslkdfj")).toBeNull();
  });

  it("throws on a non-OK, non-ZERO_RESULTS status", async () => {
    mockFetchOnce({ status: "REQUEST_DENIED", results: [] });
    await expect(geocodeAddress("x")).rejects.toThrow("REQUEST_DENIED");
  });

  it("throws on an HTTP-level failure", async () => {
    mockFetchOnce({}, false, 500);
    await expect(geocodeAddress("x")).rejects.toThrow("500");
  });

  it("throws if GOOGLE_MAPS_API_KEY is not configured", async () => {
    vi.unstubAllEnvs();
    mockFetchOnce({ status: "OK", results: [] });
    await expect(geocodeAddress("x")).rejects.toThrow("GOOGLE_MAPS_API_KEY");
  });
});
