"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewExerciseFocusModal } from "@/components/manage/new-exercise-focus-modal";
import type { ExerciseFocusItem, ExerciseSubfocusItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

type FocusWithSubs = ExerciseFocusItem & { subfocuses: ExerciseSubfocusItem[] };

function toSearchItem(focus: FocusWithSubs): SearchItem {
  return {
    id: focus.id,
    primary: focus.name,
    secondary: `${focus.subfocuses.length} subfocus${focus.subfocuses.length === 1 ? "" : "es"}`,
  };
}

export function ExerciseFocusesManageList({ initial }: { initial: FocusWithSubs[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New focus
        </Button>
      </div>
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/exercises/focuses"
        placeholder="Search focuses…"
        emptyMessage="No focuses yet."
      />
      <NewExerciseFocusModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) =>
          setItems((prev) => [...prev, { ...item, subfocuses: [] }].sort((a, b) => a.name.localeCompare(b.name)))
        }
      />
    </div>
  );
}
