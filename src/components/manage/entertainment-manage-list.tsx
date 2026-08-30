"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewEntertainmentModal } from "@/components/manage/new-entertainment-modal";
import { ENTERTAINMENT_KIND_LABELS } from "@/components/entry-forms/entertainment-entry-form";
import type { EntertainmentCatalogItem } from "@/lib/days";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(item: EntertainmentCatalogItem): SearchItem {
  return {
    id: item.id,
    primary: item.title,
    secondary: item.detail ? `${ENTERTAINMENT_KIND_LABELS[item.kind]} · ${item.detail}` : ENTERTAINMENT_KIND_LABELS[item.kind],
  };
}

export function EntertainmentManageList({ initial }: { initial: EntertainmentCatalogItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment"
        placeholder="Search entertainment…"
        emptyMessage="No matches."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New entertainment
          </Button>
        }
      />
      <NewEntertainmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.title.localeCompare(b.title)))}
      />
    </div>
  );
}
