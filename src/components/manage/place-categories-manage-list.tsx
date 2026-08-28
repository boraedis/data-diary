"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewPlaceCategoryModal } from "@/components/manage/new-place-category-modal";
import type { PlaceCategoryItem, PlaceSubcategoryItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

type CategoryWithSubs = PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] };

function toSearchItem(category: CategoryWithSubs): SearchItem {
  return {
    id: category.id,
    primary: category.name,
    secondary: `${category.subcategories.length} subcategor${category.subcategories.length === 1 ? "y" : "ies"}`,
  };
}

export function PlaceCategoriesManageList({ initial }: { initial: CategoryWithSubs[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New category
        </Button>
      </div>
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/places/categories"
        placeholder="Search categories…"
        emptyMessage="No categories yet."
      />
      <NewPlaceCategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) =>
          setItems((prev) => [...prev, { ...item, subcategories: [] }].sort((a, b) => a.name.localeCompare(b.name)))
        }
      />
    </div>
  );
}
