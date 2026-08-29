"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import type { TvShowCatalogItem } from "@/lib/days";
import type { TmdbTvSearchResult } from "@/lib/tmdb";

// Same public TMDB image CDN as the movies flow (src/components/entry-forms/
// movie-entry-form.tsx) — no API key needed client-side.
const POSTER_BASE = "https://image.tmdb.org/t/p/w92";

/** Standalone from the start (unlike the movies version, which had to be
 * retroactively exported out of movie-entry-form.tsx) — this is only ever
 * used from the TV shows Manage list (there's no day-entry "log a TV watch"
 * form yet; that's a separate future feature, episode-by-episode). Same
 * debounced-search-and-pick shape as TmdbSearchModal: type a title, pick a
 * result, it's upserted into the local `tv_shows` catalog server-side via
 * POST /api/tvshows so the real TMDB metadata is cached. */
export function TmdbTvSearchModal({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (item: TvShowCatalogItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TmdbTvSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingTmdbId, setAddingTmdbId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tmdb/tv/search?q=${encodeURIComponent(trimmed)}`);
        const body = await res.json();
        if (!res.ok) {
          setError(typeof body?.error === "string" ? body.error : "Search failed");
          setResults([]);
          return;
        }
        setError(null);
        setResults(body as TmdbTvSearchResult[]);
      } catch {
        setError("Network error");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, open]);

  async function handlePick(result: TmdbTvSearchResult) {
    setAddingTmdbId(result.tmdbId);
    setError(null);
    try {
      const res = await fetch("/api/tvshows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: result.tmdbId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to add");
        return;
      }
      onAdded(body as TvShowCatalogItem);
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
          placeholder="Search TV show titles…"
          autoFocus
        />
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border md:max-h-96">
          {searching ? (
            <p className="p-4 text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {query.trim() ? "No matches." : "Start typing a title."}
            </p>
          ) : (
            results.map((r) => (
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
                  {r.firstAirDate ? (
                    <p className="text-sm text-muted-foreground">{r.firstAirDate.slice(0, 4)}</p>
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
