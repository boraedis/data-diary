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
import type { PlaceCatalogItem, PlaceUsage } from "@/lib/days";
import type { MetroItem, PlaceCategoryItem, PlaceSubcategoryItem } from "@/lib/catalog-admin";

type ParentOption = { id: number; name: string };
type Ancestor = { id: number; name: string };

export function PlaceDetail({
  place: initial,
  usage,
  ancestry,
  children,
  metros,
  parentOptions,
  categories,
}: {
  place: PlaceCatalogItem;
  usage: PlaceUsage;
  // Root-to-self chain (getPlaceAncestry) — the last entry is this place
  // itself, so the breadcrumb below renders everything but the last one.
  ancestry: Ancestor[];
  children: PlaceCatalogItem[];
  metros: MetroItem[];
  // All places except this one and its own descendants — moving a place
  // into its own subtree is rejected server-side too (see
  // updatePlaceCatalogEntry in src/lib/days.ts), this just keeps the
  // picker from offering an option that would fail.
  parentOptions: ParentOption[];
  categories: (PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[];
}) {
  const router = useRouter();
  const [place, setPlace] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [alias, setAlias] = useState(initial.alias ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [category, setCategory] = useState(initial.category ?? "");
  const [subcategory, setSubcategory] = useState(initial.subcategory ?? "");
  const [subregionName, setSubregionName] = useState(initial.subregionName ?? "");
  const [color, setColor] = useState(initial.color ?? "");
  const [parentId, setParentId] = useState<number | null>(initial.parentId);
  const [metroId, setMetroId] = useState<number | null>(initial.metroId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancelEdit() {
    setName(place.name);
    setAlias(place.alias ?? "");
    setAddress(place.address ?? "");
    setCategory(place.category ?? "");
    setSubcategory(place.subcategory ?? "");
    setSubregionName(place.subregionName ?? "");
    setColor(place.color ?? "");
    setParentId(place.parentId);
    setMetroId(place.metroId);
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
      const res = await fetch(`/api/places/${place.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          alias: alias.trim() || null,
          address: address.trim() || null,
          category: category.trim() || null,
          subcategory: subcategory.trim() || null,
          subregionName: subregionName.trim() || null,
          color: color.trim() || null,
          parentId,
          metroId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save");
        return;
      }
      setPlace(body as PlaceCatalogItem);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  const metroName = metros.find((m) => m.id === place.metroId)?.name ?? null;
  const categoryNames = categories.map((c) => c.name);
  const subcategoryNames = categories.flatMap((c) => c.subcategories.map((s) => s.name));
  const breadcrumb = ancestry.slice(0, -1); // everything but this place itself

  return (
    <>
      <div className="flex items-center justify-between">
        <Link href="/manage/places" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Places
        </Link>
      </div>

      {breadcrumb.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {breadcrumb.map((a) => (
            <span key={a.id}>
              <Link href={`/manage/places/${a.id}`} className="hover:underline">
                {a.name}
              </Link>
              {" / "}
            </span>
          ))}
          {place.name}
        </p>
      ) : null}

      <div
        className={
          children.length > 0
            ? "flex flex-col gap-4 md:grid md:grid-cols-[1fr_20rem] md:items-start md:gap-6"
            : undefined
        }
      >
      <Card size="sm">
        <CardHeader>
          <CardTitle>{editing ? "Edit place" : place.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {editing ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="place-name">Name</Label>
                <Input id="place-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-alias">Alias</Label>
                <Input id="place-alias" value={alias} onChange={(e) => setAlias(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-address">Address</Label>
                <Input id="place-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-category">Category</Label>
                <Input
                  id="place-category"
                  list="place-category-options"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
                <datalist id="place-category-options">
                  {categoryNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-subcategory">Subcategory</Label>
                <Input
                  id="place-subcategory"
                  list="place-subcategory-options"
                  value={subcategory}
                  onChange={(e) => setSubcategory(e.target.value)}
                />
                <datalist id="place-subcategory-options">
                  {subcategoryNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-subregion">Subregion</Label>
                <Input
                  id="place-subregion"
                  value={subregionName}
                  onChange={(e) => setSubregionName(e.target.value)}
                  placeholder="neighborhood, borough…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-color">Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="place-color"
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
              <div className="space-y-1.5">
                <Label htmlFor="place-parent">Parent place</Label>
                <Select
                  id="place-parent"
                  value={parentId ?? ""}
                  onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">No parent</option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-metro">Metro</Label>
                <Select
                  id="place-metro"
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
                <dt className="text-muted-foreground">Alias</dt>
                <dd>{place.alias ?? "—"}</dd>
                <dt className="text-muted-foreground">Address</dt>
                <dd>{place.address ?? "—"}</dd>
                <dt className="text-muted-foreground">Category</dt>
                <dd>{place.category ?? "—"}</dd>
                <dt className="text-muted-foreground">Subcategory</dt>
                <dd>{place.subcategory ?? "—"}</dd>
                <dt className="text-muted-foreground">Subregion</dt>
                <dd>{place.subregionName ?? "—"}</dd>
                <dt className="text-muted-foreground">Color</dt>
                <dd className="flex items-center gap-2">
                  {place.color ? (
                    <span
                      className="inline-block size-3 rounded-full border border-border"
                      style={{ backgroundColor: place.color }}
                    />
                  ) : null}
                  {place.color ?? "—"}
                </dd>
                <dt className="text-muted-foreground">Metro</dt>
                <dd>{metroName ?? "—"}</dd>
                {place.lat !== null && place.lng !== null ? (
                  <>
                    <dt className="text-muted-foreground">Coordinates</dt>
                    <dd className="font-mono text-xs">
                      {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
                    </dd>
                  </>
                ) : null}
              </dl>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <DeleteCatalogItem
                  itemLabel={place.name}
                  isBlocked={usage.dayDates.length > 0 || usage.childCount > 0}
                  afterDeleteHref="/manage/places"
                  onDelete={async () => {
                    const res = await fetch(`/api/places/${place.id}`, { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to delete");
                  }}
                  blockedContent={
                    <div className="flex flex-col gap-2">
                      {usage.dayDates.length > 0 ? (
                        <ul className="list-inside list-disc">
                          {usage.dayDates.map((date) => (
                            <li key={date}>
                              <Link href={`/day/${date}/places`} className="text-primary hover:underline">
                                {date}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {usage.childCount > 0 ? (
                        <p>
                          {usage.childCount} sub-place{usage.childCount === 1 ? "" : "s"} still{" "}
                          {usage.childCount === 1 ? "has" : "have"} this as their parent — move or delete{" "}
                          {usage.childCount === 1 ? "it" : "them"} first.
                        </p>
                      ) : null}
                    </div>
                  }
                  warningContent={
                    usage.workoutDates.length > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Also used as a workout location on {usage.workoutDates.length}{" "}
                        {usage.workoutDates.length === 1 ? "day" : "days"} — deleting will clear the
                        location on those workouts, not block the delete.
                      </p>
                    ) : null
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {children.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Sub-places</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {children.map((c) => (
              <Link
                key={c.id}
                href={`/manage/places/${c.id}`}
                className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                {c.name}
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}
      </div>
    </>
  );
}
