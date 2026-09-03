import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// spotify.ts caches its access token in module-level state (`cachedToken`),
// so each test gets a fresh module instance via resetModules + a fresh
// dynamic import — otherwise a token fetched in one test would leak into
// the next and hide bugs in the caching logic itself.
async function freshSpotifyModule() {
  vi.resetModules();
  return import("@/lib/spotify");
}

function jsonResponse(body: unknown, ok = true, status = 200, headers: Record<string, string> = {}) {
  return {
    ok,
    status,
    headers: { get: (key: string) => headers[key] ?? null },
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  vi.stubEnv("SPOTIFY_CLIENT_ID", "client-id");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("searchArtist", () => {
  it("returns null for a blank name without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { searchArtist } = await freshSpotifyModule();
    expect(await searchArtist("   ")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches a token, then searches, and maps the top match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({ artists: { items: [{ id: "abc", name: "Radiohead", genres: ["art rock"] }] } })
      );
    vi.stubGlobal("fetch", fetchMock);
    const { searchArtist } = await freshSpotifyModule();

    expect(await searchArtist("radiohead")).toEqual({ spotifyId: "abc", name: "Radiohead", genres: ["art rock"] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Second call carries the bearer token from the first.
    const searchCallHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(searchCallHeaders.Authorization).toBe("Bearer tok");
  });

  it("returns null when the search has no matches, rather than throwing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ artists: { items: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const { searchArtist } = await freshSpotifyModule();
    expect(await searchArtist("some unknown artist")).toBeNull();
  });

  it("reuses a cached token across calls instead of re-fetching it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ artists: { items: [] } }))
      .mockResolvedValueOnce(jsonResponse({ artists: { items: [] } }));
    vi.stubGlobal("fetch", fetchMock);
    const { searchArtist } = await freshSpotifyModule();

    await searchArtist("first");
    await searchArtist("second");
    // 1 token fetch + 2 search fetches, not 2 token fetches + 2 searches.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("backs off and retries on a 429 rate-limit response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({}, false, 429, { "Retry-After": "1" }))
      .mockResolvedValueOnce(jsonResponse({ artists: { items: [{ id: "abc", name: "Retried", genres: [] }] } }));
    vi.stubGlobal("fetch", fetchMock);
    const { searchArtist } = await freshSpotifyModule();

    const resultPromise = searchArtist("x");
    // Let the token fetch and the first (429) search fetch resolve, then
    // fast-forward past the (Retry-After + 1)s backoff before asserting.
    await vi.advanceTimersByTimeAsync(3000);
    expect(await resultPromise).toEqual({ spotifyId: "abc", name: "Retried", genres: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws if Spotify credentials are not configured", async () => {
    vi.unstubAllEnvs();
    vi.stubGlobal("fetch", vi.fn());
    const { searchArtist } = await freshSpotifyModule();
    await expect(searchArtist("x")).rejects.toThrow("SPOTIFY_CLIENT_ID");
  });

  it("throws on a non-429 request failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({}, false, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { searchArtist } = await freshSpotifyModule();
    await expect(searchArtist("x")).rejects.toThrow("500");
  });
});
