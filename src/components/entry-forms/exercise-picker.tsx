"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import type { SearchItem } from "@/components/entry-forms/search-panel";
import type { ExerciseCategory } from "@/db/schema";

export type ExerciseCatalogItem = { id: number; name: string; category: ExerciseCategory };

export const EXERCISE_CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  distance: "Distance / cardio",
  sport: "Sport",
  strength: "Strength / lifting",
};

/** Search-and-select-from-catalog + "+ New" modal for exercises. A new
 * exercise needs a category picked alongside its name — the category is
 * what decides which fields the workout row shows afterward (see the
 * health entry form), so it has to be set at creation time, not guessed
 * later. The category is shown as each result's secondary line, since with
 * enough exercises in the list "Running" (distance) and "Running" (a sport
 * drill) would otherwise be indistinguishable. */
export function ExercisePicker({
  id,
  items,
  valueId,
  onChange,
  onCreated,
}: {
  id: string;
  items: ExerciseCatalogItem[];
  valueId: number | null;
  onChange: (id: number | null) => void;
  onCreated: (item: ExerciseCatalogItem) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [category, setCategory] = useState<ExerciseCategory>("distance");
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchItems: SearchItem[] = items.map((item) => ({
    id: item.id,
    primary: item.name,
    secondary: EXERCISE_CATEGORY_LABELS[item.category],
  }));

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), category }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      const created = body as ExerciseCatalogItem;
      onCreated(created);
      onChange(created.id);
      setName("");
      setModalOpen(false);
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <SearchCombobox
          id={id}
          items={searchItems}
          valueId={valueId}
          onChange={onChange}
          placeholder="Search exercises…"
        />
        <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
          + New
        </Button>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New exercise">
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-new-category`}>Category</Label>
            <Select
              id={`${id}-new-category`}
              value={category}
              onChange={(e) => setCategory(e.target.value as ExerciseCategory)}
            >
              {Object.entries(EXERCISE_CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-new-name`}>Name</Label>
            <Input
              id={`${id}-new-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
          <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
