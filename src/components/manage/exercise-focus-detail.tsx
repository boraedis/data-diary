"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type {
  ExerciseFocusItem,
  ExerciseFocusUsage,
  ExerciseSubfocusItem,
  ExerciseSubfocusUsage,
} from "@/lib/catalog-admin";

type SubfocusWithUsage = ExerciseSubfocusItem & { usage: ExerciseSubfocusUsage };

function AddSubfocusModal({
  focusId,
  open,
  onClose,
  onCreated,
}: {
  focusId: number;
  open: boolean;
  onClose: () => void;
  onCreated: (subfocus: ExerciseSubfocusItem) => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/exercise-focuses/${focusId}/subfocuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as ExerciseSubfocusItem);
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
      title="New subfocus"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="add-subfocus-name">Name</Label>
          <Input id="add-subfocus-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

function SubfocusRow({
  subfocus: initial,
  otherFocuses,
  onUpdated,
  onDeleted,
}: {
  subfocus: SubfocusWithUsage;
  otherFocuses: ExerciseFocusItem[];
  onUpdated: (subfocus: ExerciseSubfocusItem) => void;
  onDeleted: (id: number) => void;
}) {
  const [subfocus, setSubfocus] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [focusId, setFocusId] = useState(initial.focusId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/exercise-subfocuses/${subfocus.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), focusId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      const updated = { ...subfocus, ...(body as ExerciseSubfocusItem) };
      setSubfocus(updated);
      onUpdated(updated);
      setEditing(false);
      // If the focus changed, this row no longer belongs on this page —
      // the parent's onUpdated already dropped it from the current focus's
      // list (see ExerciseFocusDetail below).
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  const focusOptions = [{ id: subfocus.focusId, name: "(current)" }, ...otherFocuses].filter(
    (f, i, arr) => arr.findIndex((x) => x.id === f.id) === i
  );

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
        {otherFocuses.length > 0 ? (
          <Select value={focusId} onChange={(e) => setFocusId(Number(e.target.value))}>
            {focusOptions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.id === subfocus.focusId ? `${f.name} (current focus)` : f.name}
              </option>
            ))}
          </Select>
        ) : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        <div className="flex gap-2">
          <Button type="button" size="xs" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              setName(subfocus.name);
              setFocusId(subfocus.focusId);
              setError(null);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
      <p className="min-w-0 truncate text-sm">{subfocus.name}</p>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="xs" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <DeleteCatalogItem
          size="xs"
          itemLabel={subfocus.name}
          isBlocked={subfocus.usage.linkCount > 0}
          onDelete={async () => {
            const res = await fetch(`/api/exercise-subfocuses/${subfocus.id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete");
            onDeleted(subfocus.id);
          }}
          blockedContent={
            <p>
              {subfocus.usage.linkCount} exercise{subfocus.usage.linkCount === 1 ? "" : "s"} still tagged with this
              subfocus.
            </p>
          }
        />
      </div>
    </div>
  );
}

export function ExerciseFocusDetail({
  focus: initial,
  usage,
  subfocuses: initialSubfocuses,
  otherFocuses,
}: {
  focus: ExerciseFocusItem;
  usage: ExerciseFocusUsage;
  subfocuses: SubfocusWithUsage[];
  otherFocuses: ExerciseFocusItem[];
}) {
  const router = useRouter();
  const [focus, setFocus] = useState(initial);
  const [subfocuses, setSubfocuses] = useState(initialSubfocuses);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  function cancelEdit() {
    setName(focus.name);
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
      const res = await fetch(`/api/exercise-focuses/${focus.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setFocus(body as ExerciseFocusItem);
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
        <Link href="/manage/exercises/focuses" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Focuses
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit focus" : focus.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="exercise-focus-name">Name</Label>
                <Input id="exercise-focus-name" value={name} onChange={(e) => setName(e.target.value)} />
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
                <dt className="text-muted-foreground">Subfocuses</dt>
                <dd>{usage.subfocusCount}</dd>
                <dt className="text-muted-foreground">Tagged exercises</dt>
                <dd>{usage.linkCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={focus.name}
                  isBlocked={usage.subfocusCount > 0 || usage.linkCount > 0}
                  afterDeleteHref="/manage/exercises/focuses"
                  onDelete={async () => {
                    const res = await fetch(`/api/exercise-focuses/${focus.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <p>
                      {usage.subfocusCount} subfocus{usage.subfocusCount === 1 ? "" : "es"} and {usage.linkCount}{" "}
                      tagged exercise{usage.linkCount === 1 ? "" : "s"} still use this focus.
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
          <div className="flex items-center justify-between">
            <CardTitle>Subfocuses</CardTitle>
            <Button type="button" variant="outline" size="xs" onClick={() => setAddOpen(true)}>
              + New subfocus
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {subfocuses.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
          {subfocuses.map((s) => (
            <SubfocusRow
              key={s.id}
              subfocus={s}
              otherFocuses={otherFocuses}
              onUpdated={(updated) => {
                if (updated.focusId !== focus.id) {
                  // Moved to a different focus — no longer belongs here.
                  setSubfocuses((prev) => prev.filter((x) => x.id !== updated.id));
                  return;
                }
                setSubfocuses((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
              }}
              onDeleted={(id) => setSubfocuses((prev) => prev.filter((x) => x.id !== id))}
            />
          ))}
        </CardContent>
      </Card>

      <AddSubfocusModal
        focusId={focus.id}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(subfocus) => setSubfocuses((prev) => [...prev, { ...subfocus, usage: { linkCount: 0 } }])}
      />
    </>
  );
}
