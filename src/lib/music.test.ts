import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mock-db";
import {
  getArtistAlbums,
  getArtistTracks,
  getMusicCurationStats,
  getMusicListenStats,
  getPodcastShowEpisodes,
} from "@/lib/music";

const dbState = vi.hoisted(() => ({ current: undefined as MockDb | undefined }));
vi.mock("@/lib/db", () => ({ getDb: () => dbState.current }));

describe("getMusicListenStats", () => {
  it("converts min/max Date columns to ISO strings", async () => {
    const earliest = new Date("2020-01-01T00:00:00Z");
    const latest = new Date("2026-01-01T00:00:00Z");
    dbState.current = createMockDb([
      [
        {
          totalListens: 500,
          uniqueArtists: 42,
          uniquePodcastShows: 3,
          earliestPlayedAt: earliest,
          latestPlayedAt: latest,
        },
      ],
    ]);
    expect(await getMusicListenStats()).toEqual({
      totalListens: 500,
      uniqueArtists: 42,
      uniquePodcastShows: 3,
      earliestPlayedAt: earliest.toISOString(),
      latestPlayedAt: latest.toISOString(),
    });
  });

  it("nulls out the date range when there are no listens yet", async () => {
    dbState.current = createMockDb([
      [{ totalListens: 0, uniqueArtists: 0, uniquePodcastShows: 0, earliestPlayedAt: null, latestPlayedAt: null }],
    ]);
    const stats = await getMusicListenStats();
    expect(stats.earliestPlayedAt).toBeNull();
    expect(stats.latestPlayedAt).toBeNull();
  });
});

describe("getMusicCurationStats", () => {
  it("combines the two independent Promise.all queries in call order", async () => {
    // First queued result answers the genres select, second answers the
    // podcastShows select — this is exactly the ordering bug this kind of
    // Promise.all is easy to introduce (e.g. swapping which query populates
    // which destructured variable).
    dbState.current = createMockDb([
      [{ total: 100, grouped: 60 }],
      [{ total: 20, categorized: 5 }],
    ]);
    expect(await getMusicCurationStats()).toEqual({
      totalGenres: 100,
      groupedGenres: 60,
      totalPodcastShows: 20,
      categorizedPodcastShows: 5,
    });
  });
});

describe("getArtistAlbums / getArtistTracks / getPodcastShowEpisodes", () => {
  it("defaults a null summed total (no rows) to 0 rather than null", async () => {
    dbState.current = createMockDb([[{ albumName: "Kid A", totalMs: null, playCount: 1 }]]);
    const [album] = await getArtistAlbums(1);
    expect(album.totalMs).toBe(0);
  });

  it("passes through a real summed total for tracks", async () => {
    dbState.current = createMockDb([[{ trackName: "Idioteque", albumName: "Kid A", totalMs: 245_000, playCount: 4 }]]);
    const [track] = await getArtistTracks(1);
    expect(track).toEqual({ trackName: "Idioteque", albumName: "Kid A", totalMs: 245_000, playCount: 4 });
  });

  it("returns an empty list for a podcast show with no listens", async () => {
    dbState.current = createMockDb([[]]);
    expect(await getPodcastShowEpisodes(1)).toEqual([]);
  });
});
