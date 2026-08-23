"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import { EXERCISE_CATEGORY_LABELS } from "@/components/manage/new-exercise-modal";
import type { ExerciseCatalogItem, ExerciseUsage } from "@/lib/days";
import type { ExerciseCategory } from "@/db/schema";

export function ExerciseDetail({
  exercise: initial,
  usage,
}: {
  exercise: ExerciseCatalogItem;
  usage: ExerciseUsage;
}) {
  const router = useRouter();
  const [exercise, setExercise] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<ExerciseCategory>(initial.category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(exercise.name);
    setCategory(exercise.category);
    setError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/exercises/${exercise.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), category }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setExercise(body as ExerciseCatalogItem);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <Link href="/manage/exercises" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Exercises
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit exercise" : exercise.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="exercise-name">Name</Label>
                <Input id="exercise-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exercise-category">Category</Label>
                <Select
                  id="exercise-category"
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
              {error ? <span className="text-sm text-destructive">{error}</span> : null}
              <div className="flex gap-2">
                <Button type="button" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Category</dt>
                <dd>{EXERCISE_CATEGORY_LABELS[exercise.category]}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={exercise.name}
                  isBlocked={usage.dates.length > 0}
                  afterDeleteHref="/manage/exercises"
                  onDelete={async () => {
                    const res = await fetch(`/api/exercises/${exercise.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <ul className="list-inside list-disc">
                      {usage.dates.map((date) => (
                        <li key={date}>
                          <Link href={`/day/${date}/health`} className="text-primary hover:underline">
                            {date}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
