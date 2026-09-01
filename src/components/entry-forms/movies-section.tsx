"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { DurationInput } from "@/components/ui/duration-input";
import { NameCatalogField } from "@/components/entry-forms/name-catalog-field";
import { TmdbMovieSearchModal } from "@/components/entry-forms/tmdb-movie-search-modal";
import { usePendingOpenMatch, type PendingOpen } from "@/lib/use-pending-open";
import type { EntertainmentLocationTypeItem } from "@/lib/catalog-admin";
import type { MovieCatalogItem } from "@/lib/days";

export type MovieRow = {
  movieId: number;
  rating: number | null;
  locationType: string | null;
  durationMinutes: number | null;
};

/** The "how was the watch" modal — opens the moment a movie is picked
 * (either from the unified search, the local catalog via "+ Add from
 * TMDB", or an already-logged row being edited). Duration defaults from
 * the movie's own runtime the first time a row is opened for it, but is
 * independently editable/storable per watch (issue #61). */
function MovieDetailModal({
  open,
  movie,
  initialRating,
  initialLocationType,
  initialDurationMinutes,
  locationTypes,
  onLocationTypeCreated,
  onClose,
  onSave,
}: {
  open: boolean;
  movie: MovieCatalogItem | null;
  initialRating: number | null;
  initialLocationType: string | null;
  initialDurationMinutes: number | null;
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  onClose: () => void;
  onSave: (row: Omit<MovieRow, "movieId">) => void;
}) {
  const [rating, setRating] = useState<string>(initialRating !== null ? String(initialRating) : "");
  const [locationType, setLocationType] = useState(initialLocationType ?? "");
  const [durationMinutes, setDurationMinutes] = useState<number | null>(
    initialDurationMinutes ?? movie?.runtimeMinutes ?? null
  );

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
            <Label htmlFor="movie-detail-duration">Watch time</Label>
            <DurationInput id="movie-detail-duration" totalMinutes={durationMinutes} onChange={setDurationMinutes} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="movie-detail-location">Where</Label>
            <NameCatalogField
              id="movie-detail-location"
              value={locationType || null}
              onChange={(value) => setLocationType(value ?? "")}
              items={locationTypes}
              onCreated={onLocationTypeCreated}
              apiPath="/api/entertainment-location-types"
              modalTitle="New location type"
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              const parsed = rating.trim() ? Number(rating) : null;
              onSave({
                rating: parsed !== null && Number.isInteger(parsed) ? parsed : null,
                locationType: locationType.trim() || null,
                durationMinutes,
              });
            }}
          >
            Save
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}

export function MoviesSection({
  catalog,
  locationTypes,
  onLocationTypeCreated,
  rows,
  onRowsChange,
  pendingOpen,
}: {
  catalog: MovieCatalogItem[];
  locationTypes: EntertainmentLocationTypeItem[];
  onLocationTypeCreated: (item: EntertainmentLocationTypeItem) => void;
  rows: MovieRow[];
  onRowsChange: (rows: MovieRow[]) => void;
  pendingOpen: PendingOpen;
}) {
  const [items, setItems] = useState<MovieCatalogItem[]>(catalog);
  const [tmdbModalOpen, setTmdbModalOpen] = useState(false);
  const [detail, setDetail] = useState<{ movie: MovieCatalogItem; editIndex: number | null } | null>(null);

  const editingRow = detail?.editIndex !== null && detail?.editIndex !== undefined ? rows[detail.editIndex] : null;

  const pendingMovieId = usePendingOpenMatch(pendingOpen, "movie");
  if (pendingMovieId !== null) {
    const movie = items.find((m) => m.id === pendingMovieId);
    if (movie) setDetail({ movie, editIndex: null });
  }

  function handleAdded(item: MovieCatalogItem) {
    setItems((prev) => (prev.some((m) => m.id === item.id) ? prev : [...prev, item].sort((a, b) => a.title.localeCompare(b.title))));
    setTmdbModalOpen(false);
    setDetail({ movie: item, editIndex: null });
  }

  function openForEdit(index: number) {
    const row = rows[index];
    const movie = items.find((m) => m.id === row.movieId);
    if (!movie) return;
    setDetail({ movie, editIndex: index });
  }

  function saveDetail(value: Omit<MovieRow, "movieId">) {
    if (!detail) return;
    if (detail.editIndex !== null) {
      const next = [...rows];
      next[detail.editIndex] = { movieId: detail.movie.id, ...value };
      onRowsChange(next);
    } else {
      onRowsChange([...rows, { movieId: detail.movie.id, ...value }]);
    }
    setDetail(null);
  }

  function removeRow(index: number) {
    onRowsChange(rows.filter((_, i) => i !== index));
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Movies</CardTitle>
          <Button type="button" variant="outline" size="xs" onClick={() => setTmdbModalOpen(true)}>
            + Add from TMDB
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">None logged yet.</p> : null}
        {rows.map((row, i) => {
          const movie = items.find((m) => m.id === row.movieId);
          return (
            <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <button type="button" onClick={() => openForEdit(i)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm">{movie?.title ?? "Unknown"}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {movie?.releaseDate ? movie.releaseDate.slice(0, 4) : null}
                  {row.rating ? ` · ${row.rating}/10` : ""}
                  {row.durationMinutes ? ` · ${row.durationMinutes} min` : ""}
                  {row.locationType ? ` · ${row.locationType}` : ""}
                </p>
              </button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={() => removeRow(i)}>
                &times;
              </Button>
            </div>
          );
        })}
      </CardContent>

      <TmdbMovieSearchModal open={tmdbModalOpen} onClose={() => setTmdbModalOpen(false)} onAdded={handleAdded} />

      <MovieDetailModal
        key={detail ? `${detail.movie.id}-${detail.editIndex ?? "new"}` : "closed"}
        open={detail !== null}
        movie={detail?.movie ?? null}
        initialRating={editingRow?.rating ?? null}
        initialLocationType={editingRow?.locationType ?? null}
        initialDurationMinutes={editingRow?.durationMinutes ?? null}
        locationTypes={locationTypes}
        onLocationTypeCreated={onLocationTypeCreated}
        onClose={() => setDetail(null)}
        onSave={saveDetail}
      />
    </Card>
  );
}
