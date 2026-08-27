"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewSportModal } from "@/components/manage/new-sport-modal";
import type { SportCatalogItem } from "@/lib/days";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(sport: SportCatalogItem & { leagues: unknown[]; teams: unknown[] }): SearchItem {
  return {
    id: sport.id,
    primary: sport.name,
    secondary: `${sport.leagues.length} league${sport.leagues.length === 1 ? "" : "s"}, ${
      sport.teams.length
    } team${sport.teams.length === 1 ? "" : "s"}`,
  };
}

export function SportsManageList({
  initial,
}: {
  initial: (SportCatalogItem & { leagues: unknown[]; teams: unknown[] })[];
}) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New sport
        </Button>
      </div>
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/entertainment/sports"
        placeholder="Search sports…"
        emptyMessage="No matches."
      />
      <NewSportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => {
          setItems((prev) =>
            prev.some((s) => s.id === item.id)
              ? prev
              : [...prev, { ...item, leagues: [], teams: [] }].sort((a, b) => a.name.localeCompare(b.name))
          );
          setModalOpen(false);
        }}
      />
    </div>
  );
}
