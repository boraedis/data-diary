"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewPlaceModal } from "@/components/manage/new-place-modal";
import type { PlaceCatalogItem } from "@/lib/days";
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

export function PlacesManageList({ initial }: { initial: PlaceCatalogItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New place
        </Button>
      </div>
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/places"
        placeholder="Search places…"
        emptyMessage="No matches."
      />
      <NewPlaceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
