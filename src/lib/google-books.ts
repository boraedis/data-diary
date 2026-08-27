// Server-only Google Books API wrapper — search and volume-detail lookups
// for the books catalog (src/app/api/books, src/app/api/google-books/**).
// Never import this from a "use client" component: the API key must never
// reach the browser. Same "lazy env read at call time, not module load"
// reasoning as src/lib/tmdb.ts's getApiKey — `next build` imports every
// route handler just to inspect it, before env vars are necessarily
// available.

const GOOGLE_BOOKS_BASE_URL = "https://www.googleapis.com/books/v1";

function getApiKey(): string {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) {
    throw new Error("GOOGLE_BOOKS_API_KEY is not set");
  }
  return key;
}

async function googleBooksFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GOOGLE_BOOKS_BASE_URL}${path}`);
  url.searchParams.set("key", getApiKey());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Google Books request failed (${res.status}): ${path}`);
  }
  return (await res.json()) as T;
}

type GoogleBooksVolumeInfo = {
  title?: string;
  authors?: string[];
  publisher?: string;
  publishedDate?: string;
  description?: string;
  pageCount?: number;
  categories?: string[];
  imageLinks?: { thumbnail?: string; smallThumbnail?: string };
};

type GoogleBooksVolume = {
  id: string;
  volumeInfo?: GoogleBooksVolumeInfo;
};

type GoogleBooksSearchResponse = {
  items?: GoogleBooksVolume[];
};

export type GoogleBooksSearchResult = {
  googleBooksId: string;
  title: string;
  authors: string[];
  publishedDate: string | null;
  thumbnailUrl: string | null;
};

function toThumbnailUrl(info: GoogleBooksVolumeInfo | undefined): string | null {
  // Google's thumbnail URLs come back as http:// — upgrade to https so they
  // don't get blocked loading from a https-served page.
  const raw = info?.imageLinks?.thumbnail || info?.imageLinks?.smallThumbnail || null;
  return raw ? raw.replace(/^http:\/\//, "https://") : null;
}

/** Search Google Books by title/author — powers the live search box in the
 * "+ Add from Google Books" flow. Returns a trimmed shape (just enough to
 * render a result row); full detail is only fetched once something is
 * actually picked, via getBookDetails below. */
export async function searchBooks(query: string): Promise<GoogleBooksSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const data = await googleBooksFetch<GoogleBooksSearchResponse>("/volumes", {
    q: trimmed,
    maxResults: "20",
  });
  return (data.items ?? []).map((item) => ({
    googleBooksId: item.id,
    title: item.volumeInfo?.title ?? "Untitled",
    authors: item.volumeInfo?.authors ?? [],
    publishedDate: item.volumeInfo?.publishedDate ?? null,
    thumbnailUrl: toThumbnailUrl(item.volumeInfo),
  }));
}

export type GoogleBooksDetails = {
  googleBooksId: string;
  title: string;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  pageCount: number | null;
  categories: string[];
};

/** Full detail fetch for one book, by Google Books volume id — called
 * server-side the moment a search result is picked, so the local `books`
 * catalog row gets real metadata (publisher, description, page count,
 * categories) rather than just the search snippet. */
export async function getBookDetails(googleBooksId: string): Promise<GoogleBooksDetails> {
  const data = await googleBooksFetch<GoogleBooksVolume>(`/volumes/${encodeURIComponent(googleBooksId)}`);
  const info = data.volumeInfo;
  return {
    googleBooksId: data.id,
    title: info?.title ?? "Untitled",
    authors: info?.authors ?? [],
    publisher: info?.publisher ?? null,
    publishedDate: info?.publishedDate ?? null,
    description: info?.description ?? null,
    thumbnailUrl: toThumbnailUrl(info),
    pageCount: info?.pageCount ?? null,
    categories: info?.categories ?? [],
  };
}
