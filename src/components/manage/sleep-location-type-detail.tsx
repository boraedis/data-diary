"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import type {
  SleepLocationSubtypeItem,
  SleepLocationSubtypeUsage,
  SleepLocationTypeItem,
  SleepLocationTypeUsage,
} from "@/lib/catalog-admin";

type SubtypeWithUsage = SleepLocationSubtypeItem & { usage: SleepLocationSubtypeUsage };

function AddSubtypeModal({
  typeId,
  open,
  onClose,
  onCreated,
}: {
  typeId: number;
  open: boolean;
  onClose: () => void;
  onCreated: (subtype: SleepLocationSubtypeItem) => void;
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
      const res = await fetch(`/api/sleep-location-types/${typeId}/subtypes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as SleepLocationSubtypeItem);
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
      title="New subtype"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="add-sleep-location-subtype-name">Name</Label>
          <Input
            id="add-sleep-location-subtype-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. own bed"
            autoFocus
          />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

function SubtypeRow({
  subtype: initial,
  onUpdated,
  onDeleted,
}: {
  subtype: SubtypeWithUsage;
  onUpdated: (subtype: SleepLocationSubtypeItem) => void;
  onDeleted: (id: number) => void;
}) {
  const [subtype, setSubtype] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/sleep-location-subtypes/${subtype.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      const updated = { ...subtype, ...(body as SleepLocationSubtypeItem) };
      setSubtype(updated);
      onUpdated(updated);
      setEditing(false);
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" autoFocus />
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
              setName(subtype.name);
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
      <p className="min-w-0 truncate text-sm">{subtype.name}</p>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="xs" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <DeleteCatalogItem
          itemLabel={subtype.name}
          isBlocked={subtype.usage.dayCount > 0}
          onDelete={async () => {
            const res = await fetch(`/api/sleep-location-subtypes/${subtype.id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete");
            onDeleted(subtype.id);
          }}
          blockedContent={
            <p>
              {subtype.usage.dayCount} day{subtype.usage.dayCount === 1 ? "" : "s"} still {" "}
              {subtype.usage.dayCount === 1 ? "carries" : "carry"} this subtype.
            </p>
          }
        />
      </div>
    </div>
  );
}

export function SleepLocationTypeDetail({
  type: initial,
  usage,
  subtypes: initialSubtypes,
}: {
  type: SleepLocationTypeItem;
  usage: SleepLocationTypeUsage;
  subtypes: SubtypeWithUsage[];
}) {
  const router = useRouter();
  const [type, setType] = useState(initial);
  const [subtypes, setSubtypes] = useState(initialSubtypes);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  function cancelEdit() {
    setName(type.name);
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
      const res = await fetch(`/api/sleep-location-types/${type.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setType(body as SleepLocationTypeItem);
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
        <Link href="/manage/sleep" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Sleep location types
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit type" : type.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="sleep-location-type-name">Name</Label>
                <Input id="sleep-location-type-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Renaming doesn&rsquo;t update days that already carry the old name — see any day&rsquo;s own Sleep
                location field to change that.
              </p>
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
                <dt className="text-muted-foreground">Days</dt>
                <dd>{usage.dayCount}</dd>
                <dt className="text-muted-foreground">Subtypes</dt>
                <dd>{usage.subtypeCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={type.name}
                  isBlocked={usage.dayCount > 0 || usage.subtypeCount > 0}
                  afterDeleteHref="/manage/sleep"
                  onDelete={async () => {
                    const res = await fetch(`/api/sleep-location-types/${type.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <p>
                      {usage.dayCount} day{usage.dayCount === 1 ? "" : "s"} and {usage.subtypeCount} subtype
                      {usage.subtypeCount === 1 ? "" : "s"} still use this type.
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
            <CardTitle>Subtypes</CardTitle>
            <Button type="button" variant="outline" size="xs" onClick={() => setAddOpen(true)}>
              + New subtype
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {subtypes.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
          {subtypes.map((s) => (
            <SubtypeRow
              key={s.id}
              subtype={s}
              onUpdated={(updated) =>
                setSubtypes((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
              }
              onDeleted={(id) => setSubtypes((prev) => prev.filter((x) => x.id !== id))}
            />
          ))}
        </CardContent>
      </Card>

      <AddSubtypeModal
        typeId={type.id}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(subtype) => setSubtypes((prev) => [...prev, { ...subtype, usage: { dayCount: 0 } }])}
      />
    </>
  );
}
