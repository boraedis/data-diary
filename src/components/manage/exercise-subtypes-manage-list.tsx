"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { NewExerciseSubtypeModal } from "@/components/manage/new-exercise-subtype-modal";
import { EXERCISE_CATEGORY_LABELS } from "@/components/manage/new-exercise-modal";
import type { ExerciseSubtypeItem } from "@/lib/catalog-admin";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(subtype: ExerciseSubtypeItem): SearchItem {
  return {
    id: subtype.id,
    primary: subtype.name,
    secondary: EXERCISE_CATEGORY_LABELS[subtype.category],
  };
}

export function ExerciseSubtypesManageList({ initial }: { initial: ExerciseSubtypeItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/exercises/subtypes"
        placeholder="Search subtypes…"
        emptyMessage="No subtypes yet."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New subtype
          </Button>
        }
      />
      <NewExerciseSubtypeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) =>
          setItems((prev) =>
            [...prev, item].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
          )
        }
      />
    </div>
  );
}
