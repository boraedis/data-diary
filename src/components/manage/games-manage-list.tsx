"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewGameModal } from "@/components/manage/new-game-modal";
import type { GameCatalogItem } from "@/lib/days";
import type { GameCategoryItem, GameSubcategoryItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(item: GameCatalogItem): SearchItem {
  return { id: item.id, primary: item.name, secondary: [item.type, item.subtype].filter(Boolean).join(" · ") || null };
}

export function GamesManageList({
  initial,
  categories,
}: {
  initial: GameCatalogItem[];
  categories: (GameCategoryItem & { subcategories: GameSubcategoryItem[] })[];
}) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/games"
        placeholder="Search games…"
        emptyMessage="No games yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New game
          </Button>
        }
      />
      <NewGameModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
        categories={categories}
      />
    </div>
  );
}
