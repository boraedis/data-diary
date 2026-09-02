"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewGenreGroupModal } from "@/components/manage/new-genre-group-modal";
import type { GenreGroupItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

type GenreGroupWithCount = GenreGroupItem & { genreCount: number };

function toSearchItem(group: GenreGroupWithCount): SearchItem {
  return {
    id: group.id,
    primary: group.name,
    secondary: `${group.genreCount} ${group.genreCount === 1 ? "genre" : "genres"}`,
    accentColor: group.color,
  };
}

export function GenreGroupsManageList({ initial }: { initial: GenreGroupWithCount[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/music/genre-groups"
        placeholder="Search genre groups…"
        emptyMessage="No genre groups yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New group
          </Button>
        }
      />
      <NewGenreGroupModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
