"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewEntertainmentModal } from "@/components/manage/new-entertainment-modal";
import { NewEntertainmentKindModal } from "@/components/manage/new-entertainment-kind-modal";
import type { EntertainmentCatalogItem } from "@/lib/days";
import type { EntertainmentKindItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(item: EntertainmentCatalogItem): SearchItem {
  return {
    id: item.id,
    primary: item.title,
    secondary: item.detail ? `${item.kindName} · ${item.detail}` : item.kindName,
  };
}

export function EntertainmentManageList({
  initial,
  initialKinds,
}: {
  initial: EntertainmentCatalogItem[];
  initialKinds: EntertainmentKindItem[];
}) {
  const [items, setItems] = useState(initial);
  const [kinds, setKinds] = useState(initialKinds);
  const [modalOpen, setModalOpen] = useState(false);
  const [kindModalOpen, setKindModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment"
        placeholder="Search entertainment…"
        emptyMessage="No matches."
        trailingAction={
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={() => setKindModalOpen(true)}>
              + New kind
            </Button>
            <Button type="button" variant="outline" onClick={() => setModalOpen(true)}>
              + New entertainment
            </Button>
          </div>
        }
      />
      <NewEntertainmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.title.localeCompare(b.title)))}
        kinds={kinds}
      />
      <NewEntertainmentKindModal
        open={kindModalOpen}
        onClose={() => setKindModalOpen(false)}
        onCreated={(kind) => setKinds((prev) => [...prev, kind])}
      />
    </div>
  );
}
