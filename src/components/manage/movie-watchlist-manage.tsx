"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import { TmdbMovieSearchModal } from "@/components/entry-forms/tmdb-movie-search-modal";
import type { MovieCatalogItem, MovieWatchlistItem } from "@/lib/days";

const POSTER_BASE = "https://image.tmdb.org/t/p/w92";

function toSearchItem(movie: MovieCatalogItem): SearchItem {
  return { id: movie.id, primary: movie.title, secondary: movie.releaseDate ? movie.releaseDate.slice(0, 4) : null };
}

/** "Want to watch" list — separate from the ranking below (issue #124):
 * order here is just newest-added-first, nothing to reorder. Picking from
 * the catalog or adding a brand-new title from TMDB both add straight to
 * the watchlist in one step, same "pick and it's done" shape as every other
 * entry-form catalog pick. */
export function MovieWatchlistManage({
  initial,
  allMovies,
}: {
  initial: MovieWatchlistItem[];
  allMovies: MovieCatalogItem[];
}) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onWatchlistIds = new Set(items.map((i) => i.movieId));
  const pickableMovies = allMovies.filter((m) => !onWatchlistIds.has(m.id));

  async function addMovie(movie: MovieCatalogItem) {
    setError(null);
    try {
      const res = await fetch("/api/movies/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieId: movie.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(typeof body?.error === "string" ? body.error : "Failed to add");
        return;
      }
      setItems((prev) => [
        { movieId: movie.id, title: movie.title, posterPath: movie.posterPath, releaseDate: movie.releaseDate, addedAt: new Date().toISOString().slice(0, 10) },
        ...prev,
      ]);
    } catch {
      setError("Network error");
    }
  }

  async function removeMovie(movieId: number) {
    setError(null);
    const previous = items;
    setItems((prev) => prev.filter((i) => i.movieId !== movieId));
    const res = await fetch(`/api/movies/watchlist/${movieId}`, { method: "DELETE" });
    if (!res.ok) {
      setItems(previous);
      setError("Failed to remove");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchPanel
        items={pickableMovies.map(toSearchItem)}
        onSelect={(id) => {
          const movie = allMovies.find((m) => m.id === id);
          if (movie) void addMovie(movie);
        }}
        placeholder="Search movies…"
        emptyMessage="No matches."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + Add from TMDB
          </Button>
        }
      />
      {error ? <span className="text-sm text-destructive">{error}</span> : null}

      <Card size="sm">
        <CardContent className="flex flex-col gap-2">
          {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing on the watchlist.</p> : null}
          {items.map((item) => (
            <div key={item.movieId} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              {item.posterPath ? (
                // eslint-disable-next-line @next/next/no-img-element -- external TMDB CDN image
                <img src={`${POSTER_BASE}${item.posterPath}`} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-14 w-10 shrink-0 rounded bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[item.releaseDate ? item.releaseDate.slice(0, 4) : null, item.addedAt ? `added ${item.addedAt}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => removeMovie(item.movieId)}>
                &times;
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <TmdbMovieSearchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={(movie) => {
          setModalOpen(false);
          void addMovie(movie);
        }}
      />
    </div>
  );
}
