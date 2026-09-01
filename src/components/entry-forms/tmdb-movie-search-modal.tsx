"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { MovieCatalogItem } from "@/lib/days";
import type { TmdbMovieSearchResult } from "@/lib/tmdb";

// TMDB's public image CDN — no API key required to load images from it (only
// the search/detail JSON endpoints need the key, and those stay server-side
// via src/lib/tmdb.ts). w92 is TMDB's smallest poster size, plenty for a
// result-row thumbnail.
const POSTER_BASE = "https://image.tmdb.org/t/p/w92";

/** Standalone (extracted from the old day-entry movie-entry-form.tsx, issue
 * #61) since both the day-entry movies section and the Manage movies list's
 * own "+ New" flow need it. Debounced live TMDB search — the one flow in
 * this app's movie UI that hits the network per keystroke. Picking a result
 * upserts it into the local `movies` catalog server-side (see
 * src/app/api/movies/route.ts) so its real TMDB metadata is cached for every
 * future watch — the client never types in a title, runtime, or genre by
 * hand for movies. Mirrors TmdbTvSearchModal exactly. */
export function TmdbMovieSearchModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (item: MovieCatalogItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbMovieSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingTmdbId, setAddingTmdbId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) return;
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/tmdb/movies/search?q=${encodeURIComponent(trimmed)}`);
        const body = await res.json();
        if (!res.ok) {
          setError(typeof body?.error === "string" ? body.error : "Search failed");
          setResults([]);
          return;
        }
        setError(null);
        setResults(body as TmdbMovieSearchResult[]);
      } catch {
        setError("Network error");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, open]);

  // Query was cleared (or a previous search's results are still sitting in
  // state) — derive the "nothing to show" case at render time instead of
  // resetting `results`/`searching` synchronously from the effect above.
  const trimmedQuery = query.trim();
  const displayResults = trimmedQuery ? results : [];
  const isSearching = trimmedQuery ? searching : false;

  async function handlePick(result: TmdbMovieSearchResult) {
    setAddingTmdbId(result.tmdbId);
    setError(null);
    try {
      const res = await fetch("/api/movies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: result.tmdbId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to add");
        return;
      }
      onAdded(body as MovieCatalogItem);
      setQuery("");
      setResults([]);
    } catch {
      setError("Network error");
    } finally {
      setAddingTmdbId(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setQuery("");
        setResults([]);
        setError(null);
        onClose();
      }}
      title="Add from TMDB"
    >
      <div className="flex flex-col gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search movie titles…"
          autoFocus
        />
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border md:max-h-96">
          {isSearching ? (
            <p className="p-4 text-sm text-muted-foreground">Searching…</p>
          ) : displayResults.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {trimmedQuery ? "No matches." : "Start typing a title."}
            </p>
          ) : (
            displayResults.map((r) => (
              <button
                key={r.tmdbId}
                type="button"
                onClick={() => handlePick(r)}
                disabled={addingTmdbId !== null}
                className="flex w-full items-center gap-3 border-b border-border px-3.5 py-2.5 text-left last:border-b-0 hover:bg-accent disabled:opacity-50"
              >
                {r.posterPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${POSTER_BASE}${r.posterPath}`}
                    alt=""
                    className="h-12 w-8 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-12 w-8 shrink-0 rounded bg-muted" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-base">{r.title}</p>
                  {r.releaseDate ? (
                    <p className="text-sm text-muted-foreground">{r.releaseDate.slice(0, 4)}</p>
                  ) : null}
                </div>
                {addingTmdbId === r.tmdbId ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">Adding…</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
