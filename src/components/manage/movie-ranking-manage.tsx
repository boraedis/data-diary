"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import type { MovieCatalogItem, MovieRankingItem } from "@/lib/days";
import { RANKING_SIZE } from "@/lib/days";

const POSTER_BASE = "https://image.tmdb.org/t/p/w92";

function toSearchItem(movie: MovieCatalogItem): SearchItem {
  return { id: movie.id, primary: movie.title, secondary: movie.releaseDate ? movie.releaseDate.slice(0, 4) : null };
}

/** Top-10 ranked list (issue #124) — position IS the data, so every
 * mutation (add/remove/move) sends the whole new order to the server in one
 * PUT rather than a per-row patch (see setMovieRanking in src/lib/days.ts).
 * Reordering is plain up/down buttons rather than drag-and-drop — this app
 * has no drag-and-drop anywhere else, and a top-10 list is short enough
 * that buttons aren't a real burden. */
export function MovieRankingManage({
  initial,
  allMovies,
}: {
  initial: MovieRankingItem[];
  allMovies: MovieCatalogItem[];
}) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const rankedIds = new Set(items.map((i) => i.movieId));
  const pickableMovies = allMovies.filter((m) => !rankedIds.has(m.id));

  async function commit(next: MovieRankingItem[]) {
    const previous = items;
    setItems(next);
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/movies/ranking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieIds: next.map((i) => i.movieId) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setItems(previous);
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
      }
    } catch {
      setItems(previous);
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  function addMovie(movie: MovieCatalogItem) {
    if (items.length >= RANKING_SIZE) return;
    void commit([
      ...items,
      { rank: items.length + 1, movieId: movie.id, title: movie.title, posterPath: movie.posterPath, releaseDate: movie.releaseDate },
    ]);
  }

  function removeMovie(movieId: number) {
    void commit(
      items.filter((i) => i.movieId !== movieId).map((i, idx) => ({ ...i, rank: idx + 1 }))
    );
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    void commit(next.map((i, idx) => ({ ...i, rank: idx + 1 })));
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length < RANKING_SIZE ? (
        <SearchPanel
          items={pickableMovies.map(toSearchItem)}
          onSelect={(id) => {
            const movie = allMovies.find((m) => m.id === id);
            if (movie) addMovie(movie);
          }}
          placeholder="Search movies to add…"
          emptyMessage="No matches."
        autoFocus
      />
      ) : (
        <p className="text-sm text-muted-foreground">Ranking is full ({RANKING_SIZE}/{RANKING_SIZE}) — remove one to add another.</p>
      )}
      {error ? <span className="text-sm text-destructive">{error}</span> : null}

      <Card size="sm">
        <CardContent className="flex flex-col gap-2">
          {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing ranked yet.</p> : null}
          {items.map((item, i) => (
            <div key={item.movieId} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <span className="w-5 shrink-0 text-center text-sm font-medium text-muted-foreground">{item.rank}</span>
              {item.posterPath ? (
                // eslint-disable-next-line @next/next/no-img-element -- external TMDB CDN image
                <img src={`${POSTER_BASE}${item.posterPath}`} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-14 w-10 shrink-0 rounded bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">{item.releaseDate ? item.releaseDate.slice(0, 4) : null}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" disabled={saving || i === 0} onClick={() => move(i, -1)}>
                  &uarr;
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move down"
                  disabled={saving || i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  &darr;
                </Button>
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" disabled={saving} onClick={() => removeMovie(item.movieId)}>
                  &times;
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
