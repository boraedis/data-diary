import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMovieDetails,
  getSeasonEpisodes,
  getTvShowDetails,
  getTvShowSeasons,
  searchMovies,
  searchTvShows,
} from "@/lib/tmdb";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("TMDB_API_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("searchMovies", () => {
  it("returns [] for a blank query without calling fetch", async () => {
    const fetchMock = mockFetchOnce({ results: [] });
    expect(await searchMovies("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps TMDB's snake_case result shape to the app's camelCase shape", async () => {
    mockFetchOnce({
      results: [{ id: 42, title: "Arrival", release_date: "2016-11-11", poster_path: "/p.jpg" }],
    });
    expect(await searchMovies("arrival")).toEqual([
      { tmdbId: 42, title: "Arrival", releaseDate: "2016-11-11", posterPath: "/p.jpg" },
    ]);
  });

  it("normalizes an empty release_date string to null", async () => {
    mockFetchOnce({ results: [{ id: 1, title: "Untitled", release_date: "", poster_path: null }] });
    const [result] = await searchMovies("x");
    expect(result.releaseDate).toBeNull();
  });

  it("throws with the status code when the request fails", async () => {
    mockFetchOnce({}, false, 500);
    await expect(searchMovies("x")).rejects.toThrow("500");
  });

  it("throws if TMDB_API_KEY is not configured", async () => {
    vi.unstubAllEnvs();
    mockFetchOnce({ results: [] });
    await expect(searchMovies("x")).rejects.toThrow("TMDB_API_KEY");
  });
});

describe("getMovieDetails", () => {
  it("maps full movie detail fields, including nested genres and collection", async () => {
    mockFetchOnce({
      id: 42,
      title: "Arrival",
      release_date: "2016-11-11",
      runtime: 116,
      poster_path: "/p.jpg",
      genres: [{ id: 1, name: "Sci-Fi" }, { id: 2, name: "Drama" }],
      belongs_to_collection: null,
    });
    expect(await getMovieDetails(42)).toEqual({
      tmdbId: 42,
      title: "Arrival",
      releaseDate: "2016-11-11",
      runtimeMinutes: 116,
      posterPath: "/p.jpg",
      genres: ["Sci-Fi", "Drama"],
      collectionName: null,
    });
  });

  it("surfaces a collection name when the movie belongs to one", async () => {
    mockFetchOnce({
      id: 1,
      title: "X",
      release_date: null,
      runtime: null,
      poster_path: null,
      genres: [],
      belongs_to_collection: { name: "The X Collection" },
    });
    expect((await getMovieDetails(1)).collectionName).toBe("The X Collection");
  });
});

describe("searchTvShows", () => {
  it("maps TMDB's 'name'/'first_air_date' fields (different from movie's 'title'/'release_date')", async () => {
    mockFetchOnce({ results: [{ id: 7, name: "The Wire", first_air_date: "2002-06-02", poster_path: null }] });
    expect(await searchTvShows("wire")).toEqual([
      { tmdbId: 7, title: "The Wire", firstAirDate: "2002-06-02", posterPath: null },
    ]);
  });
});

describe("getTvShowDetails", () => {
  it("maps next-episode-to-air fields when present", async () => {
    mockFetchOnce({
      id: 7,
      name: "The Wire",
      poster_path: null,
      genres: [],
      status: "Ended",
      next_episode_to_air: { air_date: "2026-04-01", season_number: 2, episode_number: 3 },
    });
    const details = await getTvShowDetails(7);
    expect(details.nextEpisodeDate).toBe("2026-04-01");
    expect(details.nextEpisodeSeason).toBe(2);
    expect(details.nextEpisodeNumber).toBe(3);
  });

  it("nulls out next-episode fields when nothing is scheduled", async () => {
    mockFetchOnce({ id: 7, name: "The Wire", poster_path: null, genres: [], status: "Ended", next_episode_to_air: null });
    const details = await getTvShowDetails(7);
    expect(details.nextEpisodeDate).toBeNull();
    expect(details.nextEpisodeSeason).toBeNull();
    expect(details.nextEpisodeNumber).toBeNull();
  });
});

describe("getTvShowSeasons", () => {
  it("filters out season 0 ('Specials')", async () => {
    mockFetchOnce({
      seasons: [
        { season_number: 0, name: "Specials", episode_count: 5 },
        { season_number: 1, name: "Season 1", episode_count: 10 },
      ],
    });
    const seasons = await getTvShowSeasons(7);
    expect(seasons).toEqual([{ seasonNumber: 1, name: "Season 1", episodeCount: 10 }]);
  });
});

describe("getSeasonEpisodes", () => {
  it("maps episode fields", async () => {
    mockFetchOnce({
      episodes: [
        { id: 100, season_number: 1, episode_number: 1, name: "Pilot", air_date: "2002-06-02", runtime: 60 },
      ],
    });
    expect(await getSeasonEpisodes(7, 1)).toEqual([
      { tmdbEpisodeId: 100, season: 1, episode: 1, name: "Pilot", airDate: "2002-06-02", runtimeMinutes: 60 },
    ]);
  });
});
