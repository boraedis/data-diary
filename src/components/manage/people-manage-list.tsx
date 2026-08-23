"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewPersonModal } from "@/components/manage/new-person-modal";
import type { PersonCatalogItem } from "@/lib/days";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(person: PersonCatalogItem): SearchItem {
  return {
    id: person.id,
    primary: person.name,
    secondary: person.tag,
    searchTerms: person.nicknames,
  };
}

export function PeopleManageList({ initial }: { initial: PersonCatalogItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New person
        </Button>
      </div>
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/people"
        placeholder="Search people…"
        emptyMessage="No matches."
      />
      <NewPersonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
