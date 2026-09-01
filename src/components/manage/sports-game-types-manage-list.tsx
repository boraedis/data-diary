"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewSportsGameTypeModal } from "@/components/manage/new-sports-game-type-modal";
import type { SportsGameTypeItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(item: SportsGameTypeItem): SearchItem {
  return { id: item.id, primary: item.name };
}

export function SportsGameTypesManageList({ initial }: { initial: SportsGameTypeItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/sports/game-types"
        placeholder="Search game types…"
        emptyMessage="No game types yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New game type
          </Button>
        }
      />
      <NewSportsGameTypeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
