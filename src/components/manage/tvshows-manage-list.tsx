"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { TmdbTvSearchModal } from "@/components/entry-forms/tmdb-tv-search-modal";
import type { TvShowCatalogItem } from "@/lib/days";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(show: TvShowCatalogItem): SearchItem {
  return {
    id: show.id,
    primary: show.title,
    secondary: show.interested ? show.status : `${show.status ?? ""} · not interested`.trim(),
  };
}

// Mirrors MoviesManageList — reuses the TMDB search-and-add flow rather
// than a hand-typed "+ New" modal, since a show's fields are fetched, not
// typed in.
export function TvShowsManageList({ initial }: { initial: TvShowCatalogItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/tvshows"
        placeholder="Search TV shows…"
        emptyMessage="No matches."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + Add from TMDB
          </Button>
        }
      />
      <TmdbTvSearchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdded={(item) => {
          setItems((prev) =>
            prev.some((s) => s.id === item.id) ? prev : [...prev, item].sort((a, b) => a.title.localeCompare(b.title))
          );
          setModalOpen(false);
        }}
      />
    </div>
  );
}
