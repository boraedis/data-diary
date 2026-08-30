// Server-only TMDB API wrapper — search and detail lookups for the movies
// and TV shows catalogs (src/app/api/tmdb/**, src/app/api/movies,
// src/app/api/tvshows). Never import this from a "use client" component:
// the API key must never reach the browser. This deliberately does NOT
// mirror the legacy app, which hardcoded its TMDB key directly in
// client-side JS (exposed in the old repo's git history — see
// REBUILD_PLAN.md's Phase 6 notes). The key is read from `TMDB_API_KEY` at
// call time, not at module load, for the same reason as src/lib/db.ts's
// lazy DATABASE_URL read: `next build` imports every route handler just to
// inspect it, before env vars are necessarily available.

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function getApiKey(): string {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    throw new Error("TMDB_API_KEY is not set");
  }
  return key;
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  url.searchParams.set("api_key", getApiKey());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`TMDB request failed (${res.status}): ${path}`);
  }
  return (await res.json()) as T;
}

export type TmdbMovieSearchResult = {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
};

type TmdbSearchResponse = {
  results: {
    id: number;
    title: string;
    release_date: string | null;
    poster_path: string | null;
  }[];
};

/** Search TMDB's movie database by title — powers the live search box in the
 * "+ Add from TMDB" flow. Returns a trimmed shape (just enough to render a
 * result row); full detail is only fetched once something is actually
 * picked, via getMovieDetails below. */
export async function searchMovies(query: string): Promise<TmdbMovieSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const data = await tmdbFetch<TmdbSearchResponse>("/search/movie", { query: trimmed });
  return data.results.map((r) => ({
    tmdbId: r.id,
    title: r.title,
    releaseDate: r.release_date || null,
    posterPath: r.poster_path,
  }));
}

export type TmdbMovieDetails = {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  posterPath: string | null;
  genres: string[];
  collectionName: string | null;
};

type TmdbMovieResponse = {
  id: number;
  title: string;
  release_date: string | null;
  runtime: number | null;
  poster_path: string | null;
  genres: { id: number; name: string }[];
  belongs_to_collection: { name: string } | null;
};

/** Full detail fetch for one movie, by TMDB id — called server-side the
 * moment a search result is picked, so the local `movies` catalog row gets
 * real metadata (runtime, genres, collection) rather than just the search
 * snippet. */
export async function getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
  const data = await tmdbFetch<TmdbMovieResponse>(`/movie/${tmdbId}`);
  return {
    tmdbId: data.id,
    title: data.title,
    releaseDate: data.release_date || null,
    runtimeMinutes: data.runtime ?? null,
    posterPath: data.poster_path,
    genres: data.genres.map((g) => g.name),
    collectionName: data.belongs_to_collection?.name ?? null,
  };
}

// --- TV shows ---------------------------------------------------------

export type TmdbTvSearchResult = {
  tmdbId: number;
  title: string;
  firstAirDate: string | null;
  posterPath: string | null;
};

type TmdbTvSearchResponse = {
  results: {
    id: number;
    name: string;
    first_air_date: string | null;
    poster_path: string | null;
  }[];
};

export async function searchTvShows(query: string): Promise<TmdbTvSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const data = await tmdbFetch<TmdbTvSearchResponse>("/search/tv", { query: trimmed });
  return data.results.map((r) => ({
    tmdbId: r.id,
    title: r.name,
    firstAirDate: r.first_air_date || null,
    posterPath: r.poster_path,
  }));
}

export type TmdbTvShowDetails = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  genres: string[];
  status: string | null;
  nextEpisodeDate: string | null;
  nextEpisodeSeason: number | null;
  nextEpisodeNumber: number | null;
};

type TmdbTvShowResponse = {
  id: number;
  name: string;
  poster_path: string | null;
  genres: { id: number; name: string }[];
  status: string | null;
  next_episode_to_air: {
    air_date: string | null;
    season_number: number;
    episode_number: number;
  } | null;
};

/** Full detail fetch for one show, by TMDB id — same "fetch full metadata
 * the moment something is picked" pattern as getMovieDetails, plus reused
 * later for the "Refresh from TMDB" action on an already-added show (status
 * and next-episode info go stale in a way a movie's fields never do). Does
 * NOT fetch episodes — those are fetched per-season, lazily, via
 * getTvShowSeasons/getSeasonEpisodes below, only once you actually open the
 * "log an episode" flow for a show; a show can be added to the catalog long
 * before any of its episodes are looked up. */
export async function getTvShowDetails(tmdbId: number): Promise<TmdbTvShowDetails> {
  const data = await tmdbFetch<TmdbTvShowResponse>(`/tv/${tmdbId}`);
  return {
    tmdbId: data.id,
    title: data.name,
    posterPath: data.poster_path,
    genres: data.genres.map((g) => g.name),
    status: data.status,
    nextEpisodeDate: data.next_episode_to_air?.air_date || null,
    nextEpisodeSeason: data.next_episode_to_air?.season_number ?? null,
    nextEpisodeNumber: data.next_episode_to_air?.episode_number ?? null,
  };
}

// --- Episodes -----------------------------------------------------------
// The episode-watch-tracking feature this file's getTvShowDetails comment
// used to say was still pending — fetched lazily per season (not stored on
// the show row) since a show can have dozens of seasons and hundreds of
// episodes nobody will ever look up.

export type TmdbSeasonSummary = { seasonNumber: number; name: string; episodeCount: number };

type TmdbTvSeasonsResponse = {
  seasons: { season_number: number; name: string; episode_count: number }[];
};

/** Just enough to populate a season picker before fetching any one season's
 * full episode list — a second, cheap call to the same /tv/{id} endpoint
 * getTvShowDetails already hits, kept separate so callers that only need
 * metadata (add/refresh) don't pay for parsing a seasons array they'd
 * throw away. */
export async function getTvShowSeasons(tmdbId: number): Promise<TmdbSeasonSummary[]> {
  const data = await tmdbFetch<TmdbTvSeasonsResponse>(`/tv/${tmdbId}`);
  return data.seasons
    .filter((s) => s.season_number > 0) // skip "Specials" (season 0) — same call legacy's UI made
    .map((s) => ({ seasonNumber: s.season_number, name: s.name, episodeCount: s.episode_count }));
}

export type TmdbEpisodeSummary = {
  tmdbEpisodeId: number;
  season: number;
  episode: number;
  name: string | null;
  airDate: string | null;
  runtimeMinutes: number | null;
};

type TmdbSeasonResponse = {
  episodes: {
    id: number;
    season_number: number;
    episode_number: number;
    name: string | null;
    air_date: string | null;
    runtime: number | null;
  }[];
};

export async function getSeasonEpisodes(tmdbId: number, seasonNumber: number): Promise<TmdbEpisodeSummary[]> {
  const data = await tmdbFetch<TmdbSeasonResponse>(`/tv/${tmdbId}/season/${seasonNumber}`);
  return data.episodes.map((e) => ({
    tmdbEpisodeId: e.id,
    season: e.season_number,
    episode: e.episode_number,
    name: e.name,
    airDate: e.air_date || null,
    runtimeMinutes: e.runtime ?? null,
  }));
}
