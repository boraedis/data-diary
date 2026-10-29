import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertTvEpisodeMetadata } from "@/lib/days";
import { getSeasonEpisodes, getTvShowSeasons } from "@/lib/tmdb";
import { syncAllTvShowEpisodes } from "@/lib/tv-episode-catalog";

vi.mock("@/lib/days", () => ({ upsertTvEpisodeMetadata: vi.fn() }));
vi.mock("@/lib/tmdb", () => ({ getTvShowSeasons: vi.fn(), getSeasonEpisodes: vi.fn() }));

const episode = (season: number, n: number) => ({
  tmdbEpisodeId: season * 100 + n,
  season,
  episode: n,
  name: `S${season}E${n}`,
  airDate: "2020-01-01",
  runtimeMinutes: 30,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncAllTvShowEpisodes", () => {
  it("upserts every season, not just the ones opened in the picker", async () => {
    vi.mocked(getTvShowSeasons).mockResolvedValue([
      { seasonNumber: 1, name: "Season 1", episodeCount: 2 },
      { seasonNumber: 2, name: "Season 2", episodeCount: 1 },
    ]);
    vi.mocked(getSeasonEpisodes).mockImplementation(async (_tmdbId, season) =>
      season === 1 ? [episode(1, 1), episode(1, 2)] : [episode(2, 1)]
    );

    const synced = await syncAllTvShowEpisodes(7, 1399);

    expect(getSeasonEpisodes).toHaveBeenCalledWith(1399, 1);
    expect(getSeasonEpisodes).toHaveBeenCalledWith(1399, 2);
    expect(upsertTvEpisodeMetadata).toHaveBeenCalledTimes(2);
    expect(upsertTvEpisodeMetadata).toHaveBeenNthCalledWith(1, 7, [episode(1, 1), episode(1, 2)]);
    expect(upsertTvEpisodeMetadata).toHaveBeenNthCalledWith(2, 7, [episode(2, 1)]);
    expect(synced).toBe(3);
  });

  it("stops at the first TMDB failure and leaves later seasons unsynced", async () => {
    vi.mocked(getTvShowSeasons).mockResolvedValue([
      { seasonNumber: 1, name: "Season 1", episodeCount: 1 },
      { seasonNumber: 2, name: "Season 2", episodeCount: 1 },
    ]);
    vi.mocked(getSeasonEpisodes).mockRejectedValueOnce(new Error("TMDB request failed (500)"));

    await expect(syncAllTvShowEpisodes(7, 1399)).rejects.toThrow("TMDB request failed (500)");
    expect(getSeasonEpisodes).toHaveBeenCalledTimes(1);
    expect(upsertTvEpisodeMetadata).not.toHaveBeenCalled();
  });
});
