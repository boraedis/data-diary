"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewSleepLocationTypeModal } from "@/components/manage/new-sleep-location-type-modal";
import type { SleepLocationSubtypeItem, SleepLocationTypeItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

type TypeWithSubtypes = SleepLocationTypeItem & { subtypes: SleepLocationSubtypeItem[] };

function toSearchItem(type: TypeWithSubtypes): SearchItem {
  return {
    id: type.id,
    primary: type.name,
    secondary: `${type.subtypes.length} subtype${type.subtypes.length === 1 ? "" : "s"}`,
  };
}

export function SleepLocationTypesManageList({ initial }: { initial: TypeWithSubtypes[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/sleep"
        placeholder="Search sleep location types…"
        emptyMessage="No sleep location types yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New type
          </Button>
        }
      />
      <NewSleepLocationTypeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) =>
          setItems((prev) => [...prev, { ...item, subtypes: [] }].sort((a, b) => a.name.localeCompare(b.name)))
        }
      />
    </div>
  );
}
