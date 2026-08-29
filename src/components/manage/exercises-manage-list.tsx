"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CatalogBrowser } from "@/components/manage/catalog-browser";
import { EXERCISE_CATEGORY_LABELS, NewExerciseModal } from "@/components/manage/new-exercise-modal";
import type { ExerciseCatalogItem } from "@/lib/days";
import type { SearchItem } from "@/components/entry-forms/search-panel";

function toSearchItem(exercise: ExerciseCatalogItem): SearchItem {
  return { id: exercise.id, primary: exercise.name, secondary: EXERCISE_CATEGORY_LABELS[exercise.category] };
}

export function ExercisesManageList({ initial }: { initial: ExerciseCatalogItem[] }) {
  const [items, setItems] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <CatalogBrowser
        items={items.map(toSearchItem)}
        basePath="/manage/exercises"
        placeholder="Search exercises…"
        emptyMessage="No matches."
        trailingAction={
          <Button type="button" variant="outline" className="shrink-0" onClick={() => setModalOpen(true)}>
            + New exercise
          </Button>
        }
      />
      <NewExerciseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(item) => setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
