"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewPodcastCategoryModal } from "@/components/manage/new-podcast-category-modal";
import type { PodcastCategoryItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

type PodcastCategoryWithCount = PodcastCategoryItem & { showCount: number };

function toSearchItem(category: PodcastCategoryWithCount): SearchItem {
  return {
    id: category.id,
    primary: category.name,
    secondary: `${category.showCount} ${category.showCount === 1 ? "show" : "shows"}`,
  };
}

export function PodcastCategoriesManageList({ initial }: { initial: PodcastCategoryWithCount[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/music/podcast-categories"
        placeholder="Search categories…"
        emptyMessage="No podcast categories yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New category
          </Button>
        }
      />
      <NewPodcastCategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
