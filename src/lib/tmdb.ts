// Server-only TMDB API wrapper — search and movie-detail lookups for the
// movies catalog (src/app/api/tmdb/movies/search, src/app/api/movies). Never
// import this from a "use client" component: the API key must never reach
// the browser. This deliberately does NOT mirror the legacy app, which
// hardcoded its TMDB key directly in client-side JS (exposed in the old
// repo's git history — see REBUILD_PLAN.md's Phase 6 notes). The key is
// read from `TMDB_API_KEY` at call time, not at module load, for the same
// reason as src/lib/db.ts's lazy DATABASE_URL read: `next build` imports
// every route handler just to inspect it, before env vars are necessarily
// available.

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
