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
  PlaceCategoryItem,
  PlaceCategoryUsage,
  PlaceSubcategoryItem,
  PlaceSubcategoryUsage,
} from "@/lib/catalog-admin";

type SubcategoryWithUsage = PlaceSubcategoryItem & { usage: PlaceSubcategoryUsage };

function AddSubcategoryModal({
  categoryId,
  open,
  onClose,
  onCreated,
}: {
  categoryId: number;
  open: boolean;
  onClose: () => void;
  onCreated: (subcategory: PlaceSubcategoryItem) => void;
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
      const res = await fetch(`/api/place-categories/${categoryId}/subcategories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as PlaceSubcategoryItem);
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
      title="New subcategory"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="add-place-subcategory-name">Name</Label>
          <Input id="add-place-subcategory-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

function SubcategoryRow({
  subcategory: initial,
  onUpdated,
  onDeleted,
}: {
  subcategory: SubcategoryWithUsage;
  onUpdated: (subcategory: PlaceSubcategoryItem) => void;
  onDeleted: (id: number) => void;
}) {
  const [subcategory, setSubcategory] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/place-subcategories/${subcategory.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      const updated = { ...subcategory, ...(body as PlaceSubcategoryItem) };
      setSubcategory(updated);
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
              setName(subcategory.name);
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
      <p className="min-w-0 truncate text-sm">{subcategory.name}</p>
      <div className="flex shrink-0 gap-1">
        <Button type="button" size="xs" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <DeleteCatalogItem
          size="xs"
          itemLabel={subcategory.name}
          isBlocked={subcategory.usage.placeCount > 0}
          onDelete={async () => {
            const res = await fetch(`/api/place-subcategories/${subcategory.id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed to delete");
            onDeleted(subcategory.id);
          }}
          blockedContent={
            <p>
              {subcategory.usage.placeCount} place{subcategory.usage.placeCount === 1 ? "" : "s"} still {" "}
              {subcategory.usage.placeCount === 1 ? "carries" : "carry"} this subcategory.
            </p>
          }
        />
      </div>
    </div>
  );
}

export function PlaceCategoryDetail({
  category: initial,
  usage,
  subcategories: initialSubcategories,
}: {
  category: PlaceCategoryItem;
  usage: PlaceCategoryUsage;
  subcategories: SubcategoryWithUsage[];
}) {
  const router = useRouter();
  const [category, setCategory] = useState(initial);
  const [subcategories, setSubcategories] = useState(initialSubcategories);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  function cancelEdit() {
    setName(category.name);
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
      const res = await fetch(`/api/place-categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setCategory(body as PlaceCategoryItem);
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
        <Link href="/manage/places/categories" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Categories
        </Link>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit category" : category.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="place-category-name">Name</Label>
                <Input id="place-category-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Renaming doesn&rsquo;t update places that already carry the old name — see any place&rsquo;s own
                Category field to change that.
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
                <dt className="text-muted-foreground">Places</dt>
                <dd>{usage.placeCount}</dd>
                <dt className="text-muted-foreground">Subcategories</dt>
                <dd>{usage.subcategoryCount}</dd>
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={category.name}
                  isBlocked={usage.placeCount > 0 || usage.subcategoryCount > 0}
                  afterDeleteHref="/manage/places/categories"
                  onDelete={async () => {
                    const res = await fetch(`/api/place-categories/${category.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <p>
                      {usage.placeCount} place{usage.placeCount === 1 ? "" : "s"} and {usage.subcategoryCount}{" "}
                      subcategor{usage.subcategoryCount === 1 ? "y" : "ies"} still use this category.
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
            <CardTitle>Subcategories</CardTitle>
            <Button type="button" variant="outline" size="xs" onClick={() => setAddOpen(true)}>
              + New subcategory
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {subcategories.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
          {subcategories.map((s) => (
            <SubcategoryRow
              key={s.id}
              subcategory={s}
              onUpdated={(updated) =>
                setSubcategories((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
              }
              onDeleted={(id) => setSubcategories((prev) => prev.filter((x) => x.id !== id))}
            />
          ))}
        </CardContent>
      </Card>

      <AddSubcategoryModal
        categoryId={category.id}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(subcategory) =>
          setSubcategories((prev) => [...prev, { ...subcategory, usage: { placeCount: 0 } }])
        }
      />
    </>
  );
}
