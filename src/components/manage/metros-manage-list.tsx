"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewMetroModal } from "@/components/manage/new-metro-modal";
import type { MetroItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(metro: MetroItem): SearchItem {
  return {
    id: metro.id,
    primary: metro.name,
    secondary: metro.country ?? metro.alias,
    searchTerms: [metro.alias].filter((v): v is string => Boolean(v)),
  };
}

export function MetrosManageList({ initial }: { initial: MetroItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New metro
        </Button>
      </div>
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/places/metros"
        placeholder="Search metros…"
        emptyMessage="No metros yet."
      />
      <NewMetroModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
