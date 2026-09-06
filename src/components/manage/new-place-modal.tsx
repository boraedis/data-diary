"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import type { SearchItem } from "@/components/entry-forms/search-panel";
import type { PlaceCatalogItem } from "@/lib/days";
import type { MetroItem, PlaceCategoryItem, PlaceSubcategoryItem } from "@/lib/catalog-admin";
import { comparePlacesByMentions } from "@/lib/place-sort";

type ParentOption = { id: number; name: string; namePath: string | null; alias?: string | null };

// Mirrors assertValidRoot/isColorEligible/isMetroEligible in
// src/lib/days.ts and src/components/manage/place-detail.tsx — a place's
// own color only ever lives at the country level (Region → Country), and
// a metro area only at the city level (Region → Municipality). Checked
// here too so the right field pops up while creating a place, not just
// after saving and reopening it in Edit.
function isRegionCountry(category: string, subcategory: string): boolean {
  return category === "Region" && subcategory === "Country";
}
function isRegionMunicipality(category: string, subcategory: string): boolean {
  return category === "Region" && subcategory === "Municipality";
}

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
 * unless category/subcategory is "Region" → "Country" (which also then
 * requires a color), mirroring assertValidRoot in src/lib/days.ts —
 * checked here too so a bad combination shows inline instead of costing a
 * round trip. Color and Metro fields pop up the same way the edit page's
 * do (see isColorEligible/isMetroEligible in place-detail.tsx): Color for
 * Region → Country, Metro for Region → Municipality. */
export function NewPlaceModal({
  open,
  onClose,
  onCreated,
  categories,
  parentOptions,
  mentionCounts,
  metros,
  initialParentId = null,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: PlaceCatalogItem) => void;
  categories: (PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[];
  parentOptions: ParentOption[];
  mentionCounts: Map<number, number>;
  metros: MetroItem[];
  // Preset when opened from a specific spot in the world tree (see
  // place-world-tree.tsx's "+ Add child" action) rather than the flat
  // places list's own "+ New place", which always starts blank. Read once
  // on mount only — the caller is expected to remount this component (e.g.
  // via a `key` tied to the target place) when the target changes, rather
  // than this component reacting to a changed prop on an already-open
  // instance.
  initialParentId?: number | null;
}) {
  const [name, setName] = useState("");
  const [alias, setAlias] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [parentId, setParentId] = useState<number | null>(initialParentId);
  const [color, setColor] = useState("");
  const [metroId, setMetroId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCountry = isRegionCountry(category, subcategory);
  const isMunicipality = isRegionMunicipality(category, subcategory);

  const categoryNames = categories.map((c) => c.name);
  // Scoped to the selected category — an unfiltered flatMap of every
  // category's subcategories let you pick a subcategory that belongs to a
  // different category than the one chosen above.
  const subcategoryNames = categories.find((c) => c.name === category)?.subcategories.map((s) => s.name) ?? [];
  // Most-mentioned first, then shallower before deeper, then name — same
  // ordering as everywhere else the app sorts places (see
  // src/lib/place-sort.ts) — regardless of the order the caller happened to
  // pass parentOptions in.
  const parentSearchItems: SearchItem[] = useMemo(
    () =>
      [...parentOptions]
        .sort(comparePlacesByMentions(mentionCounts))
        .map((p) => ({
          id: p.id,
          primary: p.name,
          caption: displayPath(p.namePath),
          searchTerms: p.alias ? [p.alias] : undefined,
        })),
    [parentOptions, mentionCounts]
  );

  function reset() {
    setName("");
    setAlias("");
    setAddress("");
    setCategory("");
    setSubcategory("");
    setParentId(initialParentId);
    setColor("");
    setMetroId(null);
    setError(null);
  }

  async function handleCreate() {
    if (!name.trim()) return;
    // Mirrors assertValidRoot in src/lib/days.ts — checked here too so a
    // bad combination shows inline instead of costing a round trip.
    if (parentId === null) {
      if (!isCountry) {
        setError(
          'Only a "Region" → "Country" place can be top-level — pick a parent, or set category to "Region" and subcategory to "Country".'
        );
        return;
      }
      if (!color) {
        setError('A top-level ("Region" → "Country") place must have a color.');
        return;
      }
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
          color: isCountry && color ? color : null,
          metroId: isMunicipality ? metroId : null,
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
          <Label htmlFor="manage-new-place-parent">Parent place</Label>
          <SearchCombobox
            id="manage-new-place-parent"
            items={parentSearchItems}
            valueId={parentId}
            onChange={setParentId}
            placeholder="Search places…"
            emptyLabel="No parent"
          />
          {parentId === null && !isCountry ? (
            <p className="text-xs text-muted-foreground">
              Only a &ldquo;Region&rdquo; → &ldquo;Country&rdquo; place can be top-level — pick a parent, or set
              category to &ldquo;Region&rdquo; and subcategory to &ldquo;Country&rdquo;.
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-category">Category</Label>
          <Select
            id="manage-new-place-category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubcategory("");
              setColor("");
              setMetroId(null);
            }}
          >
            <option value="">— Select category —</option>
            {categoryNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="manage-new-place-subcategory">Subcategory</Label>
          <Select
            id="manage-new-place-subcategory"
            value={subcategory}
            onChange={(e) => {
              setSubcategory(e.target.value);
              setColor("");
              setMetroId(null);
            }}
            disabled={!category}
          >
            <option value="">{category ? "— Select subcategory —" : "— Select a category first —"}</option>
            {subcategoryNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
        {isCountry ? (
          <div className="space-y-1.5">
            <Label htmlFor="manage-new-place-color">Color</Label>
            <div className="flex items-center gap-2">
              <input
                id="manage-new-place-color"
                type="color"
                value={color || "#64748b"}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-16 cursor-pointer rounded border border-input bg-transparent"
              />
              {color ? (
                <Button type="button" size="xs" variant="outline" onClick={() => setColor("")}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {isMunicipality ? (
          <div className="space-y-1.5">
            <Label htmlFor="manage-new-place-metro">Metro</Label>
            <Select
              id="manage-new-place-metro"
              value={metroId ?? ""}
              onChange={(e) => setMetroId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">No metro</option>
              {metros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}
