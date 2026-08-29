"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewPlaceModal } from "@/components/manage/new-place-modal";
import type { PlaceCatalogItem } from "@/lib/days";
import type { PlaceCategoryItem, PlaceSubcategoryItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

// namePath is "USA/Georgia/Atlanta/Midtown/" (root to self, trailing
// slash) — trim the trailing slash and swap in a nicer separator for
// display, but keep matching against the raw form too (so typing "/" or
// the exact stored form still works, not just the display form).
function displayPath(namePath: string): string {
  return namePath.replace(/\/$/, "").split("/").join(" › ");
}

function toSearchItem(place: PlaceCatalogItem): SearchItem {
  return {
    id: place.id,
    primary: place.name,
    secondary: place.category ?? place.alias,
    searchTerms: [place.alias, place.address, place.namePath].filter((v): v is string => Boolean(v)),
    caption: place.namePath ? displayPath(place.namePath) : null,
  };
}

export function PlacesManageList({
  initial,
  categories,
}: {
  initial: PlaceCatalogItem[];
  categories: (PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[];
}) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/places"
        placeholder="Search places…"
        emptyMessage="No matches."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New place
          </Button>
        }
      />
      <NewPlaceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        categories={categories}
        // A brand-new place has no descendants yet, so every existing place
        // is a valid parent option — no exclusion needed (unlike the edit
        // page's parentOptions, which excludes self + descendants).
        parentOptions={items.map((p) => ({ id: p.id, name: p.name, namePath: p.namePath }))}
        // `initial` is already sorted most-mentioned-first (see
        // ManagePlacesPage) — a brand-new place has zero mentions, so it
        // belongs at the end, not re-sorted alphabetically into the middle.
        onCreated={(item) => setItems((prev) => [...prev, item])}
      />
    </div>
  );
}
