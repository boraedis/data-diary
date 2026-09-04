"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import { PLACE_SLOTS, type DayPayload, type PlacesPayload, type PlaceCatalogItem } from "@/lib/days";
import type { PlaceCategoryItem, PlaceSubcategoryItem } from "@/lib/catalog-admin";
import { comparePlacesByMentions } from "@/lib/place-sort";

function hydrate(entries: { slot: number; placeId: number }[]): (number | null)[] {
  const arr: (number | null)[] = Array(PLACE_SLOTS).fill(null);
  for (const e of entries) {
    if (e.slot < PLACE_SLOTS) arr[e.slot] = e.placeId;
  }
  return arr;
}

// namePath is "USA/Georgia/Atlanta/Midtown/" (root to self, trailing
// slash) — trim the trailing slash and swap in a nicer separator for
// display, but keep matching against the raw form too (so typing "/" or
// the exact stored form still works, not just the display form).
function displayPath(namePath: string): string {
  return namePath.replace(/\/$/, "").split("/").join(" › ");
}

function toSearchItem(place: PlaceCatalogItem): SearchItem {
  return {
    id: place.id,
    primary: place.name,
    secondary: place.category ?? place.alias,
    searchTerms: [place.alias, place.address, place.namePath].filter((v): v is string => Boolean(v)),
    caption: place.namePath ? displayPath(place.namePath) : null,
  };
}

/** New-place creation form — fields mirror the legacy "New Place" modal
 * (functions/views/entry/database/new_place_form.*): name, an optional
 * alias (matched during search, same as the legacy app), an optional
 * address, and category/subcategory. Issue #72: category/subcategory are
 * now sourced from the real DB catalogs (place_categories/place_
 * subcategories, via the `categories` prop) instead of free text, matching
 * src/components/manage/new-place-modal.tsx's datalist-backed version —
 * `category`/`subcategory` still land as free-text strings on the `places`
 * row either way (see the schema comment on the `places` table), so this
 * only changes what the input suggests, not the column type.
 *
 * Parent IS a real picker here (not free text) — a place can only be
 * top-level with category "Region" (assertValidRoot in src/lib/days.ts),
 * and virtually everything logged from a day entry is a leaf venue, so
 * defaulting to "no parent" would fail validation on almost every save. */
function NewPlaceModal({
  open,
  onClose,
  onCreated,
  parentOptions,
  mentionCounts,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (item: PlaceCatalogItem) => void;
  parentOptions: { id: number; name: string; namePath: string | null }[];
  mentionCounts: Map<number, number>;
  categories: (PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[];
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

  // Most-mentioned first, then shallower before deeper, then name (see
  // src/lib/place-sort.ts) — with the full hierarchy path as each option's
  // caption, since place names alone aren't unique (see displayPath above).
  const parentSearchItems: SearchItem[] = useMemo(
    () =>
      [...parentOptions]
        .sort(comparePlacesByMentions(mentionCounts))
        .map((p) => ({ id: p.id, primary: p.name, caption: p.namePath ? displayPath(p.namePath) : null })),
    [parentOptions, mentionCounts]
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
          <Label htmlFor="new-place-name">Name</Label>
          <Input id="new-place-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-place-alias">Alias</Label>
          <Input id="new-place-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-place-address">Address</Label>
          <Input id="new-place-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-place-parent">Parent place</Label>
          <SearchCombobox
            id="new-place-parent"
            items={parentSearchItems}
            valueId={parentId}
            onChange={setParentId}
            placeholder="Search places…"
            emptyLabel="No parent"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-place-category">Category</Label>
          <Input
            id="new-place-category"
            list="new-place-category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="restaurant, gym, friend's place…"
          />
          <datalist id="new-place-category-options">
            {categoryNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-place-subcategory">Subcategory</Label>
          <Input
            id="new-place-subcategory"
            list="new-place-subcategory-options"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
          />
          <datalist id="new-place-subcategory-options">
            {subcategoryNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
        <Button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
          {creating ? "Adding…" : "Add"}
        </Button>
      </div>
    </Modal>
  );
}

function SlotRow({
  index,
  placeId,
  places,
  onRemove,
  onPromote,
}: {
  index: number;
  placeId: number | null;
  places: PlaceCatalogItem[];
  onRemove: () => void;
  onPromote: (() => void) | null;
}) {
  const place = placeId !== null ? places.find((p) => p.id === placeId) ?? null : null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0">
        {place ? 
        <p>
          {index + 1 + " — " + place.name}
        </p>
        :
        <p className="text-muted-foreground">
          {index + 1 + " — empty"}
        </p>}
        
      </div>
      {place ? (
        <div className="flex shrink-0 items-center gap-1">
          {onPromote ? (
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Move up" onClick={onPromote}>
              ↑
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Remove" onClick={onRemove}>
            &times;
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function PlacesEntryForm({
  date,
  initial,
  catalog,
  mentionCounts,
  rawMentionCounts,
  categories,
}: {
  date: string;
  initial: PlacesPayload;
  catalog: PlaceCatalogItem[];
  mentionCounts: Map<number, number>;
  rawMentionCounts: Map<number, number>;
  categories: (PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<PlaceCatalogItem[]>(catalog);
  const [slots, setSlots] = useState<(number | null)[]>(() => hydrate(initial.entries));
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Sorted by raw (own-mentions-only, not hierarchy roll-up) mentions so
  // actually-visited venues rank above a rarely-mentioned parent region
  // (issue #72c) — the parent picker inside NewPlaceModal below
  // deliberately keeps the roll-up version (`mentionCounts`), since ranking
  // *regions* by their whole family's mentions is the right call there.
  // Same place can now fill both slots (issue #72b) — no longer filtered
  // out of the search list just because it's already used in a slot.
  const searchItems = [...items].sort(comparePlacesByMentions(rawMentionCounts)).map(toSearchItem);

  function handleCreated(item: PlaceCatalogItem) {
    setItems((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
  }

  function addPlace(placeId: number) {
    setSavedAt(null);
    setSlots((prev) => {
      const idx = prev.findIndex((v) => v === null);
      if (idx === -1) return prev;
      const next = [...prev];
      next[idx] = placeId;
      return next;
    });
  }

  function removeSlot(slot: number) {
    setSavedAt(null);
    setSlots((prev) => {
      const next = [...prev];
      next.splice(slot, 1);
      next.push(null);
      return next;
    });
  }

  function promoteSlot(slot: number) {
    setSavedAt(null);
    setSlots((prev) => {
      if (slot === 0) return prev;
      const next = [...prev];
      [next[slot - 1], next[slot]] = [next[slot], next[slot - 1]];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const entries: PlacesPayload["entries"] = slots
      .map((placeId, slot) => (placeId !== null ? { slot, placeId } : null))
      .filter((e): e is PlacesPayload["entries"][number] => e !== null);

    try {
      const res = await fetch(`/api/days/${date}/places`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }

      const saved = body as DayPayload;
      setSlots(hydrate(saved.places));
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 pb-20">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Places</CardTitle>
          <CardDescription>
            {PLACE_SLOTS} places. Search to pick somewhere — it fills the next open slot.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-2">
            {slots.map((placeId, slot) => (
              <SlotRow
                key={slot}
                index={slot}
                placeId={placeId}
                places={items}
                onRemove={() => removeSlot(slot)}
                onPromote={slot > 0 ? () => promoteSlot(slot) : null}
              />
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Add a place</Label>
              <Button type="button" variant="outline" size="xs" onClick={() => setModalOpen(true)}>
                + New place
              </Button>
            </div>
            <SearchPanel
              items={searchItems}
              onSelect={addPlace}
              placeholder=”Search places…”
              emptyMessage=”No matches — try “+ New place”.”
              autoFocus
            />
            <NewPlaceModal
              open={modalOpen}
              onClose={() => setModalOpen(false)}
              parentOptions={items.map((p) => ({ id: p.id, name: p.name, namePath: p.namePath }))}
              mentionCounts={mentionCounts}
              categories={categories}
              onCreated={(item) => {
                handleCreated(item);
                addPlace(item.id);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3 md:max-w-2xl">
          <span className="text-sm">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedAt ? (
              <span className="text-muted-foreground">Saved.</span>
            ) : null}
          </span>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}
