"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewGameDeviceModal } from "@/components/manage/new-game-device-modal";
import type { GameDeviceItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(item: GameDeviceItem): SearchItem {
  return { id: item.id, primary: item.name };
}

export function GameDevicesManageList({ initial }: { initial: GameDeviceItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/games/devices"
        placeholder="Search devices…"
        emptyMessage="No devices yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New device
          </Button>
        }
      />
      <NewGameDeviceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
