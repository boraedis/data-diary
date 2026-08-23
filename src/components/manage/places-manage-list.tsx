"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewPlaceModal } from "@/components/manage/new-place-modal";
import type { PlaceCatalogItem } from "@/lib/days";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(place: PlaceCatalogItem): SearchItem {
  return {
    id: place.id,
    primary: place.name,
    secondary: place.category ?? place.alias,
    searchTerms: [place.alias, place.address].filter((v): v is string => Boolean(v)),
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
