"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { TmdbSearchModal } from "@/components/entry-forms/movie-entry-form";
import type { MovieCatalogItem } from "@/lib/days";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(movie: MovieCatalogItem): SearchItem {
  return { id: movie.id, primary: movie.title, secondary: movie.releaseDate ? movie.releaseDate.slice(0, 4) : null };
}

// Reuses the entry form's live-TMDB-search modal rather than a hand-typed
// "+ New" modal like the other catalogs — a movie's fields are never typed
// in, only fetched (see src/lib/tmdb.ts), so the add flow here is identical
// to the one on the day-entry form, just without opening the rating/where
// detail modal afterward.
export function MoviesManageList({ initial }: { initial: MovieCatalogItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/movies"
        placeholder="Search movies…"
        emptyMessage="No matches."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + Add from TMDB
          </Button>
        }
      />
      <TmdbSearchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={(item) => {
          setItems((prev) =>
            prev.some((m) => m.id === item.id) ? prev : [...prev, item].sort((a, b) => a.title.localeCompare(b.title))
          );
          setModalOpen(false);
        }}
      />
    </div>
  );
}
