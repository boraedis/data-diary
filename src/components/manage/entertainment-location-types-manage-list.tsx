"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewEntertainmentLocationTypeModal } from "@/components/manage/new-entertainment-location-type-modal";
import type { EntertainmentLocationTypeItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(item: EntertainmentLocationTypeItem): SearchItem {
  return { id: item.id, primary: item.name };
}

export function EntertainmentLocationTypesManageList({ initial }: { initial: EntertainmentLocationTypeItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/location-types"
        placeholder="Search location types…"
        emptyMessage="No location types yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New location type
          </Button>
        }
      />
      <NewEntertainmentLocationTypeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
