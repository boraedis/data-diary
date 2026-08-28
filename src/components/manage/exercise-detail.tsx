"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import { EXERCISE_CATEGORY_LABELS } from "@/components/manage/new-exercise-modal";
import type { ExerciseCatalogItem, ExerciseUsage } from "@/lib/days";
import type { ExerciseCategory } from "@/db/schema";
import type { ExerciseFocusItem, ExerciseFocusLink, ExerciseSubfocusItem } from "@/lib/catalog-admin";

type FocusWithSubs = ExerciseFocusItem & { subfocuses: ExerciseSubfocusItem[] };

function AddFocusLinkModal({
  exerciseId,
  allFocuses,
  open,
  onClose,
  onCreated,
}: {
  exerciseId: number;
  allFocuses: FocusWithSubs[];
  open: boolean;
  onClose: () => void;
  onCreated: (link: ExerciseFocusLink) => void;
}) {
  const [focusId, setFocusId] = useState<number | null>(allFocuses[0]?.id ?? null);
  const [subfocusId, setSubfocusId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subfocusOptions = allFocuses.find((f) => f.id === focusId)?.subfocuses ?? [];

  function reset() {
    setFocusId(allFocuses[0]?.id ?? null);
    setSubfocusId(null);
    setLabel("");
    setError(null);
  }

  async function handleCreate() {
    if (focusId === null) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/exercises/${exerciseId}/focuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focusId, subfocusId, label: label.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to add");
        return;
      }
      const focus = allFocuses.find((f) => f.id === focusId);
      const subfocus = subfocusOptions.find((s) => s.id === subfocusId);
      onCreated({
        id: (body as { id: number }).id,
        exerciseId,
        focusId,
        subfocusId,
        label: label.trim() || null,
        focusName: focus?.name ?? "",
        subfocusName: subfocus?.name ?? null,
      });
      reset();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Add focus tag"
    >
      <div className="flex flex-col gap-3">
        {allFocuses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No focuses yet — add one under Exercises &rarr; Focuses first.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="add-focus-link-focus">Focus</Label>
              <Select
                id="add-focus-link-focus"
                value={focusId ?? ""}
                onChange={(e) => {
                  setFocusId(e.target.value ? Number(e.target.value) : null);
                  setSubfocusId(null);
                }}
              >
                {allFocuses.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </div>
            {subfocusOptions.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="add-focus-link-subfocus">Subfocus</Label>
                <Select
                  id="add-focus-link-subfocus"
                  value={subfocusId ?? ""}
                  onChange={(e) => setSubfocusId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">No subfocus</option>
                  {subfocusOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="add-focus-link-label">Label</Label>
              <Input
                id="add-focus-link-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="optional note"
              />
            </div>
            {error ? <span className="text-sm text-destructive">{error}</span> : null}
            <Button type="button" onClick={handleCreate} disabled={creating || focusId === null}>
              {creating ? "Adding…" : "Add"}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

function FocusLinkRow({ link, onDeleted }: { link: ExerciseFocusLink; onDeleted: (id: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm">
          {link.focusName}
          {link.subfocusName ? ` · ${link.subfocusName}` : ""}
        </p>
        {link.label ? <p className="truncate text-xs text-muted-foreground">{link.label}</p> : null}
      </div>
      <DeleteCatalogItem
        itemLabel={link.subfocusName ? `${link.focusName} · ${link.subfocusName}` : link.focusName}
        isBlocked={false}
        onDelete={async () => {
          const res = await fetch(`/api/exercises/${link.exerciseId}/focuses/${link.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("Failed to delete");
          onDeleted(link.id);
        }}
        blockedContent={null}
      />
    </div>
  );
}

export function ExerciseDetail({
  exercise: initial,
  usage,
  focusLinks: initialFocusLinks,
  allFocuses,
}: {
  exercise: ExerciseCatalogItem;
  usage: ExerciseUsage;
  focusLinks: ExerciseFocusLink[];
  allFocuses: FocusWithSubs[];
}) {
  const router = useRouter();
  const [exercise, setExercise] = useState(initial);
  const [focusLinks, setFocusLinks] = useState(initialFocusLinks);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<ExerciseCategory>(initial.category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addFocusOpen, setAddFocusOpen] = useState(false);

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

      <Card size="sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Focus tags</CardTitle>
            <Button type="button" variant="outline" size="xs" onClick={() => setAddFocusOpen(true)}>
              + Add
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {focusLinks.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
          {focusLinks.map((link) => (
            <FocusLinkRow
              key={link.id}
              link={link}
              onDeleted={(id) => setFocusLinks((prev) => prev.filter((l) => l.id !== id))}
            />
          ))}
        </CardContent>
      </Card>

      <AddFocusLinkModal
        exerciseId={exercise.id}
        allFocuses={allFocuses}
        open={addFocusOpen}
        onClose={() => setAddFocusOpen(false)}
        onCreated={(link) => setFocusLinks((prev) => [...prev, link])}
      />
    </>
  );
}
