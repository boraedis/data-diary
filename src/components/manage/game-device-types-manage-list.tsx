"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewGameDeviceTypeModal } from "@/components/manage/new-game-device-type-modal";
import type { GameDeviceTypeItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(item: GameDeviceTypeItem): SearchItem {
  return { id: item.id, primary: item.name };
}

export function GameDeviceTypesManageList({ initial }: { initial: GameDeviceTypeItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/games/device-types"
        placeholder="Search device types…"
        emptyMessage="No device types yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New device type
          </Button>
        }
      />
      <NewGameDeviceTypeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
