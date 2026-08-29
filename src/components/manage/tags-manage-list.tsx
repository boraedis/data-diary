"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewTagModal } from "@/components/manage/new-tag-modal";
import type { TagCatalogItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

type TagWithCount = TagCatalogItem & { memberCount: number };

function toSearchItem(tag: TagWithCount): SearchItem {
  return {
    id: tag.id,
    primary: tag.name,
    secondary: `${tag.memberCount} ${tag.memberCount === 1 ? "person" : "people"}`,
    accentColor: tag.color,
  };
}

export function TagsManageList({ initial }: { initial: TagWithCount[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/people/tags"
        placeholder="Search tags…"
        emptyMessage="No tags yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New tag
          </Button>
        }
      />
      <NewTagModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
