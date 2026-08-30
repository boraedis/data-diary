"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import type { SearchItem } from "@/components/entry-forms/search-panel";
import { DeleteCatalogItem } from "@/components/manage/delete-catalog-item";
import { comparePlacesByMentions } from "@/lib/place-sort";
import type { PlaceAncestor, PlaceCatalogItem, PlaceMentionEntry, PlaceUsage } from "@/lib/days";
import type { MetroItem, PlaceCategoryItem, PlaceSubcategoryItem } from "@/lib/catalog-admin";

type ParentOption = { id: number; name: string; namePath: string | null };

// Legacy's exact gating condition for showing the metro picker at all (see
// the `metros` table comment in schema.ts) — a "metro area" is assigned at
// the city level of the location hierarchy (category Region, subcategory
// Municipality), never at country/state level or on a leaf venue.
function isMetroEligible(category: string | null, subcategory: string | null): boolean {
  return category === "Region" && subcategory === "Municipality";
}

// Root-to-self path, human-readable ("USA / Georgia / Atlanta / Midtown").
function displayNamePath(namePath: string): string {
  return namePath.replace(/\/$/, "").split("/").join(" / ");
}

export function PlaceDetail({
  place: initial,
  usage,
  ancestry,
  childPlaces,
  metros,
  parentOptions,
  categories,
  mentionsOwn,
  mentionsWithDescendants,
  mentionCounts,
}: {
  place: PlaceCatalogItem;
  usage: PlaceUsage;
  // Root-to-self chain (getPlaceAncestry) — the last entry is this place
  // itself, so the breadcrumb below renders everything but the last one.
  // Also carries category/subcategory/color/metroId for every ancestor,
  // used to resolve the color/metro inheritance below.
  ancestry: PlaceAncestor[];
  childPlaces: PlaceCatalogItem[];
  metros: MetroItem[];
  // All places except this one and its own descendants — moving a place
  // into its own subtree is rejected server-side too (see
  // updatePlaceCatalogEntry in src/lib/days.ts), this just keeps the
  // picker from offering an option that would fail.
  parentOptions: ParentOption[];
  categories: (PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[];
  // Both pre-fetched server-side (see getPlaceMentionHistory in
  // src/lib/days.ts) so the "Show descendants" toggle below just swaps
  // between them client-side instead of round-tripping.
  mentionsOwn: PlaceMentionEntry[];
  mentionsWithDescendants: PlaceMentionEntry[];
  // For sorting the parent picker below — most-mentioned first, see
  // src/lib/place-sort.ts.
  mentionCounts: Map<number, number>;
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
  // Only meaningful (and only ever written to) when the place being edited
  // is itself root/Region+Municipality-eligible — see isRootEditing/
  // isMetroEligibleEditing below, which decide whether these inputs are
  // live or just showing an inherited value.
  const [color, setColor] = useState(initial.color ?? "");
  const [parentId, setParentId] = useState<number | null>(initial.parentId);
  const [metroId, setMetroId] = useState<number | null>(initial.metroId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReparentOpen, setConfirmReparentOpen] = useState(false);
  const [showDescendants, setShowDescendants] = useState(false);

  // Most-mentioned first, then shallower before deeper, then name (see
  // src/lib/place-sort.ts) — with the full hierarchy path as each option's
  // caption, since place names alone aren't unique (two "Dubai"s, an
  // emirate and a city) and the path is what actually disambiguates them.
  const parentSearchItems: SearchItem[] = useMemo(
    () =>
      [...parentOptions]
        .sort(comparePlacesByMentions(mentionCounts))
        .map((p) => ({ id: p.id, primary: p.name, caption: p.namePath ? displayNamePath(p.namePath) : null })),
    [parentOptions, mentionCounts]
  );

  const mainCardRef = useRef<HTMLDivElement>(null);
  const [relatedCardHeight, setRelatedCardHeight] = useState<number | null>(null);

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

  async function performSave() {
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
      setConfirmReparentOpen(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  function handleSave() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    // Mirrors assertValidRoot in src/lib/days.ts — checked here too so a
    // bad combination shows inline instead of costing a round trip.
    if (parentId === null && category.trim() !== "Region") {
      setError('Only a "Region" place can be top-level (no parent) — set a parent, or set category to "Region".');
      return;
    }
    setError(null);
    // Re-parenting cascades to every descendant's stored path (see
    // cascadePlacePaths in src/lib/days.ts) — confirm first, mirroring
    // legacy's own submitWorldEdit confirmation (world.js).
    if (parentId !== place.parentId) {
      setConfirmReparentOpen(true);
      return;
    }
    void performSave();
  }

  const metroName = metros.find((m) => m.id === place.metroId)?.name ?? null;
  const categoryNames = categories.map((c) => c.name);
  const subcategoryNames = categories.flatMap((c) => c.subcategories.map((s) => s.name));
  const breadcrumb = ancestry.slice(0, -1); // everything but this place itself
  // Immediate parent, if any — same info as the last breadcrumb entry, just
  // surfaced as a quick link alongside the sub-places below rather than only
  // in the text breadcrumb above.
  const parent = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1] : null;
  const hasRelatedPlaces = parent !== null || childPlaces.length > 0;

  // --- related-places card height, capped to match the edit card --------
  // The two cards sit in a CSS grid side by side (md+), but the default
  // align-items: stretch alone doesn't actually cap this card's height:
  // an "auto" grid row sizes to the MAX of every item's natural content
  // height, including this one's — so a long sub-places list still grows
  // the row (and the whole page) to fit itself before overflow-y-auto
  // ever gets a bounded box to scroll within. Measuring the edit card's
  // real rendered height and applying it directly breaks that
  // circularity: once this card has an explicit height, its CardContent's
  // overflow-y-auto below has something concrete to scroll inside of
  // instead of just expanding to match.
  useEffect(() => {
    const el = mainCardRef.current;
    if (!el || !hasRelatedPlaces) return;
    // Only pin the height side-by-side (md+) — below that the cards stack
    // full-width, and forcing the second one to match the (often much
    // taller, especially while editing) first one would just waste mobile
    // screen space for no side-by-side alignment to gain from it.
    const mql = window.matchMedia("(min-width: 768px)");
    function sync() {
      setRelatedCardHeight(mql.matches && el ? el.offsetHeight : null);
    }
    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(el);
    mql.addEventListener("change", sync);
    return () => {
      resizeObserver.disconnect();
      mql.removeEventListener("change", sync);
    };
  }, [hasRelatedPlaces, editing]);

  // --- color inheritance (root-only field — see the `places` table
  // comment in schema.ts) ---------------------------------------------
  const rootAncestor = ancestry.length > 0 ? ancestry[0] : null; // ancestry[0] IS `place` itself when place is root
  const viewIsRoot = place.parentId === null;
  const viewColor = viewIsRoot ? place.color : (rootAncestor?.color ?? null);
  const editIsRoot = parentId === null;
  // While editing, the color input stays live for a root place; for a
  // non-root place it just displays the (fixed, as-loaded) root color,
  // disabled — reflecting the CURRENT position, not a pending unsaved
  // parent change, same simplification the metro inheritance below makes.
  const editColorValue = editIsRoot ? color : (rootAncestor?.color ?? "");

  // --- metro inheritance (Region + Municipality-only field — see the
  // `metros` table comment in schema.ts) -------------------------------
  const metroSourceAncestor =
    [...ancestry].reverse().find((a) => isMetroEligible(a.category, a.subcategory)) ?? null;
  const viewIsMetroEligible = metroSourceAncestor?.id === place.id;
  const viewMetroId = metroSourceAncestor?.metroId ?? null;
  const viewMetroName = viewIsMetroEligible ? metroName : (metros.find((m) => m.id === viewMetroId)?.name ?? null);
  const editIsMetroEligible = isMetroEligible(category.trim() || null, subcategory.trim() || null);
  const editMetroValue = editIsMetroEligible ? metroId : viewMetroId;

  const mentions = showDescendants ? mentionsWithDescendants : mentionsOwn;

  const selectedNewParent = parentId !== null ? parentOptions.find((p) => p.id === parentId) : undefined;
  const oldPathDisplay = place.namePath ? displayNamePath(place.namePath) : place.name;
  const newPathDisplay =
    parentId === null
      ? name.trim() || place.name
      : `${selectedNewParent?.namePath ? displayNamePath(selectedNewParent.namePath) : (selectedNewParent?.name ?? "?")} / ${name.trim() || place.name}`;

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
          hasRelatedPlaces
            ? "flex flex-col gap-4 md:grid md:grid-cols-[1fr_20rem] md:gap-6"
            : undefined
        }
      >
      {/* md:self-start is the actual fix: without it, this wrapper is a
          grid item too and the default align-items: stretch inflates ITS
          height to match the row — which is exactly the tall value we're
          trying to measure and cap the other column to, so the
          measurement below was circular (always just echoing whatever
          the sub-places list's natural height already was). Pinning this
          one to its own natural content height breaks that. */}
      <div ref={mainCardRef} className="md:self-start">
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
                <Label htmlFor="place-parent">Parent place</Label>
                <SearchCombobox
                  id="place-parent"
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
                <Label htmlFor="place-color">
                  Color{" "}
                  {!editIsRoot ? (
                    <span className="font-normal text-muted-foreground">
                      (inherited from {rootAncestor?.name ?? "root"})
                    </span>
                  ) : null}
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    id="place-color"
                    type="color"
                    value={editColorValue || "#64748b"}
                    onChange={(e) => setColor(e.target.value)}
                    disabled={!editIsRoot}
                    className="h-8 w-16 cursor-pointer rounded border border-input bg-transparent disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {editIsRoot && color ? (
                    <Button type="button" size="xs" variant="outline" onClick={() => setColor("")}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="place-metro">
                  Metro{" "}
                  {!editIsMetroEligible ? (
                    <span className="font-normal text-muted-foreground">
                      {metroSourceAncestor
                        ? `(inherited from ${metroSourceAncestor.name})`
                        : "(only Region → Municipality places have their own)"}
                    </span>
                  ) : null}
                </Label>
                <Select
                  id="place-metro"
                  value={editMetroValue ?? ""}
                  onChange={(e) => setMetroId(e.target.value ? Number(e.target.value) : null)}
                  disabled={!editIsMetroEligible}
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
                <dt className="text-muted-foreground">Path</dt>
                <dd className="font-mono text-xs">{place.namePath ? displayNamePath(place.namePath) : "—"}</dd>
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
                  {viewColor ? (
                    <span
                      className="inline-block size-3 rounded-full border border-border"
                      style={{ backgroundColor: viewColor }}
                    />
                  ) : null}
                  {viewColor ?? "—"}
                  {!viewIsRoot && viewColor ? (
                    <span className="text-xs text-muted-foreground">(from {rootAncestor?.name})</span>
                  ) : null}
                </dd>
                <dt className="text-muted-foreground">Metro</dt>
                <dd className="flex items-center gap-2">
                  {viewMetroName ?? "—"}
                  {!viewIsMetroEligible && viewMetroName ? (
                    <span className="text-xs text-muted-foreground">(from {metroSourceAncestor?.name})</span>
                  ) : null}
                </dd>
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
      </div>

      {hasRelatedPlaces ? (
        <Card
          size="sm"
          className="md:min-h-0"
          style={relatedCardHeight !== null ? { height: relatedCardHeight } : undefined}
        >
          <CardHeader>
            <CardTitle>Related places</CardTitle>
          </CardHeader>
          {/* min-h-0 + flex-1 lets this panel shrink below its content size
              inside the flex-col Card — needed so the Sub-places section
              below can claim the remaining space instead of everything
              just stacking to full content height. The Card itself is
              capped to the edit card's measured height (see the effect
              above), so this is what actually gives the Sub-places list
              something concrete to scroll inside of. The Parent link
              (if any) stays outside that scroll area, always visible. */}
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            {parent ? (
              <div className="flex shrink-0 flex-col gap-1.5">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Parent</p>
                <Link
                  href={`/manage/places/${parent.id}`}
                  className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  {parent.name}
                </Link>
              </div>
            ) : null}
            {childPlaces.length > 0 ? (
              <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Sub-places</p>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                  {childPlaces.map((c) => (
                    <Link
                      key={c.id}
                      href={`/manage/places/${c.id}`}
                      className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      </div>

      <Card size="sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Mentions</CardTitle>
            {childPlaces.length > 0 ? (
              <label className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showDescendants}
                  onChange={(e) => setShowDescendants(e.target.checked)}
                  className="size-4 rounded border-input"
                />
                Show descendants
              </label>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex max-h-96 flex-col gap-2 overflow-y-auto">
          {mentions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Never mentioned on a day.</p>
          ) : (
            mentions.map((m, i) => (
              <Link
                key={`${m.date}-${m.slot}-${m.placeId}-${i}`}
                href={`/day/${m.date}/places`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <span>{m.date}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {showDescendants && m.placeId !== place.id ? <span>{m.placeName}</span> : null}
                  <span className={m.slot === "1st & 2nd" ? "font-medium text-foreground" : undefined}>{m.slot}</span>
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {/* Mirrors legacy's submitWorldEdit confirmation (world.js) — moving a
          place changes its own path and cascades to every descendant's
          path too (cascadePlacePaths in src/lib/days.ts), so this is worth
          an explicit confirm rather than a silent save. */}
      <Modal open={confirmReparentOpen} onClose={() => setConfirmReparentOpen(false)} title={`Move ${place.name}?`}>
        <div className="flex flex-col gap-3 text-sm">
          <p>You are changing the position of {place.name}.</p>
          <p>
            The old path was <span className="font-mono text-xs">{oldPathDisplay}</span>.
          </p>
          <p>
            The new path will be <span className="font-mono text-xs">{newPathDisplay}</span>.
          </p>
          {childPlaces.length > 0 ? (
            <p className="text-muted-foreground">
              {childPlaces.length} sub-place{childPlaces.length === 1 ? "" : "s"} underneath{" "}
              {childPlaces.length === 1 ? "it moves" : "them move"} too.
            </p>
          ) : null}
          <p>Are you sure you wish to do this?</p>
          {error ? <span className="text-destructive">{error}</span> : null}
          <div className="flex gap-2">
            <Button type="button" onClick={performSave} disabled={saving}>
              {saving ? "Saving…" : "Yes, move it"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmReparentOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
