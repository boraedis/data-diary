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
import { CatalogUsageHistory } from "@/components/manage/catalog-usage-history";
import { EXERCISE_CATEGORY_LABELS } from "@/components/manage/new-exercise-modal";
import type { ExerciseSubtypeItem, ExerciseSubtypeUsage } from "@/lib/catalog-admin";
import type { ExerciseCategory } from "@/db/schema";

export function ExerciseSubtypeDetail({
  subtype: initial,
  usage,
}: {
  subtype: ExerciseSubtypeItem;
  usage: ExerciseSubtypeUsage;
}) {
  const router = useRouter();
  const [subtype, setSubtype] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<ExerciseCategory>(initial.category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(subtype.name);
    setCategory(subtype.category);
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
      const res = await fetch(`/api/exercise-subtypes/${subtype.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), category }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setSubtype(body as ExerciseSubtypeItem);
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
        <Link href="/manage/exercises/subtypes" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Subtypes
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit subtype" : subtype.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="exercise-subtype-name">Name</Label>
                <Input id="exercise-subtype-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exercise-subtype-category">Category</Label>
                <Select
                  id="exercise-subtype-category"
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
                <dd>{EXERCISE_CATEGORY_LABELS[subtype.category]}</dd>
              </dl>
              <p className="text-xs text-muted-foreground">
                A workout&rsquo;s subtype is free text, not a reference into this catalog — renaming or deleting
                here won&rsquo;t change any already-logged workout.
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={subtype.name}
                  isBlocked={usage.workoutCount > 0}
                  afterDeleteHref="/manage/exercises/subtypes"
                  onDelete={async () => {
                    const res = await fetch(`/api/exercise-subtypes/${subtype.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <p>
                      {usage.workoutCount} workout{usage.workoutCount === 1 ? "" : "s"} still use this subtype.
                    </p>
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Logged on</CardTitle>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          <CatalogUsageHistory
            history={usage.workouts.map((w) => ({ date: w.date, label: w.exerciseName }))}
            daySegment="health"
            emptyText="No workouts logged."
          />
        </CardContent>
      </Card>
    </>
  );
}
