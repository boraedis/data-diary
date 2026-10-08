"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import type { SearchItem } from "@/components/entry-forms/search-panel";
import { NewPlaceModal } from "@/components/manage/new-place-modal";
import type { PlaceCatalogItem } from "@/lib/days";
import type { MetroItem, PlaceCategoryItem, PlaceSubcategoryItem } from "@/lib/catalog-admin";

/** What the full "New place" modal needs beyond the places list itself —
 * loaded once per page and threaded through, rather than each picker
 * fetching its own copy. */
export type PlaceCreateOptions = {
  categories: (PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[];
  metros: MetroItem[];
  mentionCounts: Map<number, number>;
};

// namePath is "USA/Georgia/Atlanta/Midtown/" — same display transform the
// places entry form and the manage modal use, so a same-named venue in two
// cities is still tellable apart in the dropdown.
function displayPath(namePath: string | null): string | null {
  return namePath ? namePath.replace(/\/$/, "").split("/").join(" › ") : null;
}

/**
 * Search-and-select a place, with "+ New" opening the real New Place modal
 * (parent, category/subcategory, alias, address — #582). Workout locations
 * used to go through the generic name-only `CatalogPicker`, which POSTed
 * just `{ name }` to /api/places: a place with no parent fails
 * assertValidRoot unless it's a Region → Country, so the button either
 * errored or, at best, produced a parentless orphan the hierarchy charts
 * can't place. Places are a tree, not a flat name catalog, so every place
 * creation now goes through the one modal that knows that.
 */
export function PlacePicker({
  id,
  places,
  valueId,
  onChange,
  onCreated,
  createOptions,
}: {
  id: string;
  places: PlaceCatalogItem[];
  valueId: number | null;
  onChange: (id: number | null) => void;
  onCreated: (item: PlaceCatalogItem) => void;
  createOptions: PlaceCreateOptions;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const searchItems: SearchItem[] = places.map((place) => ({
    id: place.id,
    primary: place.name,
    secondary: place.category,
    caption: displayPath(place.namePath),
    searchTerms: [place.alias, place.namePath].filter((v): v is string => Boolean(v)),
  }));

  return (
    <>
      <div className="flex items-center gap-2.5">
        <SearchCombobox id={id} items={searchItems} valueId={valueId} onChange={onChange} placeholder="Search places…" />
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New
        </Button>
      </div>

      <NewPlaceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        categories={createOptions.categories}
        metros={createOptions.metros}
        mentionCounts={createOptions.mentionCounts}
        parentOptions={places}
        onCreated={(item) => {
          onCreated(item);
          onChange(item.id);
        }}
      />
    </>
  );
}
