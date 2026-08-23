"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import type { DayPayload, MovieCatalogItem, MoviesPayload } from "@/lib/days";
import type { TmdbMovieSearchResult } from "@/lib/tmdb";

// TMDB's public image CDN — no API key required to load images from it (only
// the search/detail JSON endpoints need the key, and those stay server-side
// via src/lib/tmdb.ts). w92 is TMDB's smallest poster size, plenty for a
// result-row thumbnail.
const POSTER_BASE = "https://image.tmdb.org/t/p/w92";

type Row = { movieId: number; rating: number | null; locationType: string | null };

function toSearchItem(movie: MovieCatalogItem): SearchItem {
  return {
    id: movie.id,
    primary: movie.title,
    secondary: movie.releaseDate ? movie.releaseDate.slice(0, 4) : null,
  };
}

/** Debounced live TMDB search — the one flow in this form that hits the
 * network per keystroke (everything else searches the already-loaded local
 * catalog in memory, same as every other entry form). Picking a result
 * upserts it into the local `movies` catalog server-side (see
 * src/app/api/movies/route.ts) so its real TMDB metadata is cached for every
 * future watch — the client never types in a title, runtime, or genre by
 * hand for movies. */
export function TmdbSearchModal({
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
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
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
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          {searching ? (
            <p className="p-3 text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {query.trim() ? "No matches." : "Start typing a title."}
            </p>
          ) : (
            results.map((r) => (
              <button
                key={r.tmdbId}
                type="button"
                onClick={() => handlePick(r)}
                disabled={addingTmdbId !== null}
                className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-accent disabled:opacity-50"
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
                  <p className="truncate text-sm">{r.title}</p>
                  {r.releaseDate ? (
                    <p className="text-xs text-muted-foreground">{r.releaseDate.slice(0, 4)}</p>
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

/** The "how was the watch" modal — opens the moment a movie is picked
 * (either from the local catalog via search, or freshly added from TMDB),
 * and is also how an already-logged watch gets edited. Mirrors
 * EntertainmentDetailModal's reuse-for-both-add-and-edit pattern. */
function MovieDetailModal({
  open,
  movie,
  initialRating,
  initialLocationType,
  onClose,
  onSave,
}: {
  open: boolean;
  movie: MovieCatalogItem | null;
  initialRating: number | null;
  initialLocationType: string | null;
  onClose: () => void;
  onSave: (rating: number | null, locationType: string | null) => void;
}) {
  const [rating, setRating] = useState<string>(initialRating !== null ? String(initialRating) : "");
  const [locationType, setLocationType] = useState(initialLocationType ?? "");

  return (
    <Modal open={open} onClose={onClose} title={movie?.title ?? ""}>
      {movie ? (
        <div className="flex flex-col gap-3">
          {movie.releaseDate || movie.runtimeMinutes ? (
            <p className="text-xs text-muted-foreground">
              {[
                movie.releaseDate ? movie.releaseDate.slice(0, 4) : null,
                movie.runtimeMinutes ? `${movie.runtimeMinutes} min` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="movie-detail-rating">Rating (1–10)</Label>
            <Input
              id="movie-detail-rating"
              type="number"
              min={1}
              max={10}
              step={1}
              value={rating}
              onChange={(e) => setRating(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="movie-detail-location">Where</Label>
            <Input
              id="movie-detail-location"
              value={locationType}
              onChange={(e) => setLocationType(e.target.value)}
              placeholder="theater, home…"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              const parsed = rating.trim() ? Number(rating) : null;
              onSave(
                parsed !== null && Number.isInteger(parsed) ? parsed : null,
                locationType.trim() || null
              );
            }}
          >
            Save
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

export function MovieEntryForm({
  date,
  initial,
  catalog,
}: {
  date: string;
  initial: DayPayload["movies"];
  catalog: MovieCatalogItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<MovieCatalogItem[]>(catalog);
  const [rows, setRows] = useState<Row[]>(
    initial.map((w) => ({ movieId: w.movieId, rating: w.rating, locationType: w.locationType }))
  );
  const [tmdbModalOpen, setTmdbModalOpen] = useState(false);
  const [detail, setDetail] = useState<{ movie: MovieCatalogItem; editIndex: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const editingRow = detail?.editIndex !== null && detail?.editIndex !== undefined ? rows[detail.editIndex] : null;

  function handleAdded(item: MovieCatalogItem) {
    setItems((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, item].sort((a, b) => a.title.localeCompare(b.title))));
    setTmdbModalOpen(false);
    setDetail({ movie: item, editIndex: null });
  }

  function openForPick(id: number) {
    const movie = items.find((m) => m.id === id);
    if (!movie) return;
    setDetail({ movie, editIndex: null });
  }

  function openForEdit(index: number) {
    const row = rows[index];
    const movie = items.find((m) => m.id === row.movieId);
    if (!movie) return;
    setDetail({ movie, editIndex: index });
  }

  function saveDetail(rating: number | null, locationType: string | null) {
    if (!detail) return;
    setSavedAt(null);
    setRows((prev) => {
      if (detail.editIndex !== null) {
        const next = [...prev];
        next[detail.editIndex] = { movieId: detail.movie.id, rating, locationType };
        return next;
      }
      return [...prev, { movieId: detail.movie.id, rating, locationType }];
    });
    setDetail(null);
  }

  function removeRow(index: number) {
    setSavedAt(null);
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload: MoviesPayload = { entries: rows };

    try {
      const res = await fetch(`/api/days/${date}/movies`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setRows(saved.movies.map((w) => ({ movieId: w.movieId, rating: w.rating, locationType: w.locationType })));
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-20">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Movies</CardTitle>
          <CardDescription>
            {rows.length === 0 ? "None logged yet." : `${rows.length} logged.`} Search something you've
            watched before, or add a new one from TMDB.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.length > 0 ? (
            <div className="flex flex-col gap-2">
              {rows.map((row, i) => {
                const movie = items.find((m) => m.id === row.movieId);
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => openForEdit(i)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm">{movie?.title ?? "Unknown"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {movie?.releaseDate ? movie.releaseDate.slice(0, 4) : null}
                        {row.rating ? ` · ${row.rating}/10` : ""}
                        {row.locationType ? ` · ${row.locationType}` : ""}
                      </p>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Remove"
                      onClick={() => removeRow(i)}
                    >
                      &times;
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Add a movie</Label>
              <Button type="button" variant="outline" size="xs" onClick={() => setTmdbModalOpen(true)}>
                + Add from TMDB
              </Button>
            </div>
            <SearchPanel
              items={items.map(toSearchItem)}
              onSelect={openForPick}
              placeholder="Search movies you've logged before…"
              emptyMessage="No matches — try “+ Add from TMDB”."
            />
          </div>
        </CardContent>
      </Card>

      <TmdbSearchModal open={tmdbModalOpen} onClose={() => setTmdbModalOpen(false)} onAdded={handleAdded} />

      <MovieDetailModal
        key={detail ? `${detail.movie.id}-${detail.editIndex ?? "new"}` : "closed"}
        open={detail !== null}
        movie={detail?.movie ?? null}
        initialRating={editingRow?.rating ?? null}
        initialLocationType={editingRow?.locationType ?? null}
        onClose={() => setDetail(null)}
        onSave={saveDetail}
      />

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3">
          <span className="text-sm">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedAt ? (
              <span className="text-muted-foreground">Saved.</span>
            ) : null}
          </span>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
