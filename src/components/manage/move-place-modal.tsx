"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { SearchCombobox } from "@/components/entry-forms/search-combobox";
import type { SearchItem } from "@/components/entry-forms/search-panel";
import { comparePlacesByMentions } from "@/lib/place-sort";
import { getDescendantIdSet } from "@/lib/place-tree";
import type { PlaceCatalogItem } from "@/lib/days";

// namePath is "USA/Georgia/Atlanta/Midtown/" (root to self, trailing
// slash) — same display convention as place-detail.tsx/new-place-modal.tsx.
function displayNamePath(namePath: string): string {
  return namePath.replace(/\/$/, "").split("/").join(" / ");
}

/** Standalone "move this place" flow, opened from a spot in the world tree
 * (place-world-tree.tsx) rather than from the full place-edit form — same
 * underlying operation as place-detail.tsx's parent field plus its
 * reparent-confirm modal (both PATCH /api/places/[id] with every field but
 * a new parentId, and both show the same old-path/new-path/descendant-count
 * confirmation, mirroring legacy's submitWorldEdit), just reachable
 * directly from the tree without opening the full edit form first.
 *
 * Two steps: pick a new parent, then confirm. `place` must carry every
 * field the PATCH body needs (validatePlaceCatalogEntry in src/lib/days.ts
 * requires the full record, not just the changed field) — pass the same
 * PlaceCatalogItem the tree already has in memory. */
export function MovePlaceModal({
  open,
  onClose,
  place,
  allPlaces,
  mentionCounts,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  place: PlaceCatalogItem;
  // The full flat catalog — used both to build the parent picker (excluding
  // `place` and its own descendants, which the API would reject anyway —
  // see updatePlaceCatalogEntry's "can't move a place into its own subtree"
  // guard — but excluding them here means the picker never even offers a
  // choice that could fail) and to display the new path's ancestor names.
  allPlaces: PlaceCatalogItem[];
  mentionCounts: Map<number, number>;
  onMoved: (updated: PlaceCatalogItem) => void;
}) {
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [newParentId, setNewParentId] = useState<number | null>(place.parentId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descendantIds = useMemo(() => getDescendantIdSet(place.id, allPlaces), [place.id, allPlaces]);

  const parentSearchItems: SearchItem[] = useMemo(
    () =>
      allPlaces
        .filter((p) => p.id !== place.id && !descendantIds.has(p.id))
        .sort(comparePlacesByMentions(mentionCounts))
        .map((p) => ({ id: p.id, primary: p.name, caption: p.namePath ? displayNamePath(p.namePath) : null })),
    [allPlaces, place.id, descendantIds, mentionCounts]
  );

  const newParent = newParentId !== null ? allPlaces.find((p) => p.id === newParentId) : undefined;
  const rootBlocked = newParentId === null && place.category !== "Region";
  const unchanged = newParentId === place.parentId;

  const oldPathDisplay = place.namePath ? displayNamePath(place.namePath) : place.name;
  const newPathDisplay =
    newParentId === null
      ? place.name
      : `${newParent?.namePath ? displayNamePath(newParent.namePath) : (newParent?.name ?? "?")} / ${place.name}`;

  function reset() {
    setStep("pick");
    setNewParentId(place.parentId);
    setError(null);
  }

  async function performMove() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/places/${place.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: place.name,
          alias: place.alias,
          address: place.address,
          category: place.category,
          subcategory: place.subcategory,
          subregionName: place.subregionName,
          color: place.color,
          metroId: place.metroId,
          parentId: newParentId,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to move");
        return;
      }
      onMoved(body as PlaceCatalogItem);
      reset();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={step === "pick" ? `Move ${place.name}` : `Move ${place.name}?`}
    >
      {step === "pick" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Pick a new parent for {place.name}.</p>
          <SearchCombobox
            id="move-place-parent"
            items={parentSearchItems}
            valueId={newParentId}
            onChange={setNewParentId}
            placeholder="Search places…"
            emptyLabel="No parent (top-level)"
          />
          {rootBlocked ? (
            <p className="text-xs text-muted-foreground">
              Only a &ldquo;Region&rdquo; place can be top-level — {place.name} is {place.category ?? "not"} a
              Region, so pick a parent instead.
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" onClick={() => setStep("confirm")} disabled={unchanged || rootBlocked}>
              Continue
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p>You are changing the position of {place.name}.</p>
          <p>
            The old path was <span className="font-mono text-xs">{oldPathDisplay}</span>.
          </p>
          <p>
            The new path will be <span className="font-mono text-xs">{newPathDisplay}</span>.
          </p>
          {descendantIds.size > 0 ? (
            <p className="text-muted-foreground">
              {descendantIds.size} sub-place{descendantIds.size === 1 ? "" : "s"} underneath{" "}
              {descendantIds.size === 1 ? "it moves" : "them move"} too.
            </p>
          ) : null}
          <p>Are you sure you wish to do this?</p>
          {error ? <span className="text-destructive">{error}</span> : null}
          <div className="flex gap-2">
            <Button type="button" onClick={performMove} disabled={saving}>
              {saving ? "Moving…" : "Yes, move it"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setStep("pick")} disabled={saving}>
              Back
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
