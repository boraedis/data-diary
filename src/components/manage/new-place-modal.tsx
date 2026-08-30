"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import type { SearchItem } from "@/components/entry-forms/search-panel";
import type { PlaceCatalogItem } from "@/lib/days";
import type { PlaceCategoryItem, PlaceSubcategoryItem } from "@/lib/catalog-admin";

type ParentOption = { id: number; name: string; namePath: string | null };

// namePath is "USA/Georgia/Atlanta/Midtown/" (root to self, trailing
// slash) — trim it and swap in a nicer separator for display. Shown as
// every option's caption so same-named places at different levels of the
// hierarchy (place names aren't unique — "Dubai" the emirate vs "Dubai"
// the city) are still distinguishable in the picker.
function displayPath(namePath: string | null): string | null {
  return namePath ? namePath.replace(/\/$/, "").split("/").join(" › ") : null;
}

/** Same fields/shape as the places entry form's own "+ New" modal — kept as
 * a separate copy rather than importing that one, since it's private to
 * that file and the entry-form and manage contexts are reasonable to let
 * drift independently (same call already made for people/entertainment).
 *
 * Category/subcategory are sourced from the real DB catalogs (place_
 * categories/place_subcategories, via the `categories` prop) rather than
 * freely typed — matches the edit page's datalist. Parent is required
 * unless category is "Region", mirroring assertValidRoot in
 * src/lib/days.ts (only a Region place can be top-level) — checked here
 * too so a bad combination shows inline instead of costing a round trip. */
export function NewPlaceModal({
  open,
  onClose,
  onCreated,
  categories,
  parentOptions,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: PlaceCatalogItem) => void;
  categories: (PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[];
  parentOptions: ParentOption[];
}) {
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [parentId, setParentId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryNames = categories.map((c) => c.name);
  const subcategoryNames = categories.flatMap((c) => c.subcategories.map((s) => s.name));
  // Sorted alphabetically regardless of the order the caller happened to
  // pass in (e.g. places-manage-list.tsx's own list is mention-sorted).
  const parentSearchItems: SearchItem[] = useMemo(
    () =>
      [...parentOptions]
        .sort((a, b) => a.name.localeCompare(b.name) || (a.namePath ?? "").localeCompare(b.namePath ?? ""))
        .map((p) => ({ id: p.id, primary: p.name, caption: displayPath(p.namePath) })),
    [parentOptions]
  );

  function reset() {
    setName("");
    setAlias("");
    setAddress("");
    setCategory("");
    setSubcategory("");
    setParentId(null);
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    if (parentId === null && category.trim() !== "Region") {
      setError('Only a "Region" place can be top-level — pick a parent, or set category to "Region".');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          alias: alias.trim() || null,
          address: address.trim() || null,
          category: category.trim() || null,
          subcategory: subcategory.trim() || null,
          parentId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to create");
        return;
      }
      onCreated(body as PlaceCatalogItem);
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
      title="New place"
    >
      <div className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-name">Name</Label>
          <Input id="manage-new-place-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-alias">Alias</Label>
          <Input id="manage-new-place-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-address">Address</Label>
          <Input id="manage-new-place-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-category">Category</Label>
          <Input
            id="manage-new-place-category"
            list="manage-new-place-category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="restaurant, gym, friend's place…"
          />
          <datalist id="manage-new-place-category-options">
            {categoryNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-subcategory">Subcategory</Label>
          <Input
            id="manage-new-place-subcategory"
            list="manage-new-place-subcategory-options"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
          />
          <datalist id="manage-new-place-subcategory-options">
            {subcategoryNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-parent">Parent place</Label>
          <SearchCombobox
            id="manage-new-place-parent"
            items={parentSearchItems}
            valueId={parentId}
            onChange={setParentId}
            placeholder="Search places…"
            emptyLabel="No parent"
          />
          {parentId === null && category.trim() !== "Region" ? (
            <p className="text-xs text-muted-foreground">
              Only a &ldquo;Region&rdquo; place can be top-level — pick a parent, or set category to
              &ldquo;Region&rdquo;.
            </p>
          ) : null}
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}
