"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewGameCategoryModal } from "@/components/manage/new-game-category-modal";
import type { GameCategoryItem, GameSubcategoryItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

type CategoryWithSubs = GameCategoryItem & { subcategories: GameSubcategoryItem[] };

function toSearchItem(category: CategoryWithSubs): SearchItem {
  return {
    id: category.id,
    primary: category.name,
    secondary: `${category.subcategories.length} subcategor${category.subcategories.length === 1 ? "y" : "ies"}`,
  };
}

export function GameCategoriesManageList({ initial }: { initial: CategoryWithSubs[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/games/categories"
        placeholder="Search categories…"
        emptyMessage="No categories yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New category
          </Button>
        }
      />
      <NewGameCategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) =>
          setItems((prev) => [...prev, { ...item, subcategories: [] }].sort((a, b) => a.name.localeCompare(b.name)))
        }
      />
    </div>
  );
}
