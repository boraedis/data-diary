"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewPersonModal } from "@/components/manage/new-person-modal";
import type { PersonCatalogItem } from "@/lib/days";
import type { TagCatalogItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(person: PersonCatalogItem): SearchItem {
  return {
    id: person.id,
    primary: person.name,
    secondary: person.tagName,
    searchTerms: person.nicknames,
    accentColor: person.tagColor,
  };
}

export function PeopleManageList({
  initial,
  initialTags,
}: {
  initial: PersonCatalogItem[];
  initialTags: TagCatalogItem[];
}) {
  const [items, setItems] = useState(initial);
  const [tags, setTags] = useState(initialTags);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/people"
        placeholder="Search people…"
        emptyMessage="No matches."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New person
          </Button>
        }
      />
      <NewPersonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
        tags={tags}
        onTagCreated={(tag) => setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]))}
      />
    </div>
  );
}
