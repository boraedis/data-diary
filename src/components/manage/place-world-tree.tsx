"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewPlaceModal } from "@/components/manage/new-place-modal";
import { MovePlaceModal } from "@/components/manage/move-place-modal";
import { buildPlaceForest, findMatchingAndAncestorIds, type PlaceNode } from "@/lib/place-tree";
import { comparePlacesByMentions } from "@/lib/place-sort";
import { cn } from "@/lib/utils";
import type { PlaceCatalogItem } from "@/lib/days";
import type { PlaceCategoryItem, PlaceSubcategoryItem } from "@/lib/catalog-admin";

function collectIds(nodes: PlaceNode<PlaceCatalogItem>[], out: Set<number>) {
  for (const n of nodes) {
    out.add(n.place.id);
    collectIds(n.children, out);
  }
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  isMatch,
  mentionCounts,
  onAddChild,
  onMove,
}: {
  node: PlaceNode<PlaceCatalogItem>;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  isMatch: (id: number) => boolean;
  mentionCounts: Map<number, number>;
  onAddChild: (parentId: number) => void;
  onMove: (placeId: number) => void;
}) {
  const { place, children } = node;
  const hasChildren = children.length > 0;
  const open = expanded.has(place.id);
  // Own + every descendant's mentions (see getPlaceMentionCounts in
  // src/lib/days.ts) — in a tree, that's exactly "how much has happened
  // under this branch", not just at this one node.
  const count = mentionCounts.get(place.id) ?? 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-lg py-1.5 pr-1.5 hover:bg-muted",
          isMatch(place.id) && "bg-primary/10"
        )}
        style={{ paddingLeft: `${depth * 1.25 + 0.375}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(place.id)}
            aria-label={open ? `Collapse ${place.name}` : `Expand ${place.name}`}
            aria-expanded={open}
            className="flex size-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}
        {place.color ? (
          <span
            className="size-2.5 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: place.color }}
            aria-hidden
          />
        ) : null}
        <Link href={`/manage/places/${place.id}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
          {place.name}
        </Link>
        {place.category ? (
          <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:inline">{place.category}</span>
        ) : null}
        {count > 0 ? (
          <span
            className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title={`${count} mention${count === 1 ? "" : "s"}, including sub-places`}
          >
            {count}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Add a place under ${place.name}`}
          title="Add child place"
          onClick={() => onAddChild(place.id)}
        >
          +
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Move ${place.name}`}
          title="Move to a different parent"
          onClick={() => onMove(place.id)}
        >
          ⇄
        </Button>
      </div>
      {hasChildren && open ? (
        <div>
          {children.map((child) => (
            <TreeRow
              key={child.place.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              isMatch={isMatch}
              mentionCounts={mentionCounts}
              onAddChild={onAddChild}
              onMove={onMove}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Hierarchy browser + editor for the places tree — the rebuild's answer to
 * legacy's world.js Miller-columns view (see world.js's loadWorldView/
 * addWorldLevel/submitWorldEdit), deliberately built differently: instead
 * of one column per drill-down level (which needs real horizontal space
 * legacy could assume a desktop-only admin panel had), this is a single
 * expandable/collapsible indented tree — the whole flat catalog is already
 * in memory (see place-tree.ts), so there's no need to fetch one level at
 * a time either. Reparenting reuses the exact same guarded PATCH +
 * confirmation flow as place-detail.tsx's edit form (via MovePlaceModal),
 * just reachable directly from wherever a place sits in the tree instead
 * of needing to open its full edit page first.
 *
 * Deliberately out of scope here: full field edits and delete both stay on
 * the place detail page (one click away via each row's name link) — this
 * view is for browsing the shape of the hierarchy and making *structural*
 * changes to it (adding a place somewhere specific, moving a branch),
 * not a duplicate of the edit form. */
export function PlaceWorldTree({
  initial,
  categories,
  mentionCounts,
}: {
  initial: PlaceCatalogItem[];
  categories: (PlaceCategoryItem & { subcategories: PlaceSubcategoryItem[] })[];
  mentionCounts: Map<number, number>;
}) {
  const [places, setPlaces] = useState(initial);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [addChildTarget, setAddChildTarget] = useState<number | "root" | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<number | null>(null);

  const compare = useMemo(() => comparePlacesByMentions(mentionCounts), [mentionCounts]);
  const forest = useMemo(() => buildPlaceForest(places, compare), [places, compare]);
  // Ancestor ids of every match get merged into the expanded set below —
  // that's what reveals a match buried in an otherwise-collapsed branch
  // without hiding the rest of the tree's shape.
  const filter = useMemo(() => findMatchingAndAncestorIds(search, places), [search, places]);

  const effectiveExpanded = useMemo(() => {
    if (!filter) return expanded;
    const merged = new Set(expanded);
    for (const id of filter.ancestors) merged.add(id);
    return merged;
  }, [expanded, filter]);

  function isMatch(id: number) {
    return filter?.matches.has(id) ?? false;
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<number>();
    collectIds(forest, all);
    setExpanded(all);
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  function handleCreated(item: PlaceCatalogItem) {
    setPlaces((prev) => [...prev, item]);
    // Reveal the new place immediately rather than leaving it invisible
    // under a still-collapsed parent. Captured to a local first — TS
    // narrowing on a property access like `item.parentId` doesn't persist
    // into the nested setExpanded callback below.
    const parentId = item.parentId;
    if (parentId !== null) {
      setExpanded((prev) => new Set(prev).add(parentId));
    }
  }

  function handleMoved(updated: PlaceCatalogItem) {
    setPlaces((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    const parentId = updated.parentId;
    if (parentId !== null) {
      setExpanded((prev) => new Set(prev).add(parentId));
    }
  }

  const moveTarget = moveTargetId !== null ? (places.find((p) => p.id === moveTargetId) ?? null) : null;
  const parentOptionsForAdd = useMemo(
    () => places.map((p) => ({ id: p.id, name: p.name, namePath: p.namePath })),
    [places]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="min-w-0 flex-1"
          aria-label="Search places"
        />
        <Button type="button" variant="outline" size="xs" onClick={expandAll}>
          Expand all
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={collapseAll}>
          Collapse all
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => setAddChildTarget("root")}>
          + Add root place
        </Button>
      </div>

      {forest.length === 0 ? (
        <p className="text-sm text-muted-foreground">No places yet.</p>
      ) : (
        <div className="flex flex-col">
          {forest.map((node) => (
            <TreeRow
              key={node.place.id}
              node={node}
              depth={0}
              expanded={effectiveExpanded}
              onToggle={toggle}
              isMatch={isMatch}
              mentionCounts={mentionCounts}
              onAddChild={(id) => setAddChildTarget(id)}
              onMove={(id) => setMoveTargetId(id)}
            />
          ))}
        </div>
      )}

      {addChildTarget !== null ? (
        <NewPlaceModal
          key={addChildTarget}
          open
          onClose={() => setAddChildTarget(null)}
          onCreated={(item) => {
            handleCreated(item);
            setAddChildTarget(null);
          }}
          categories={categories}
          parentOptions={parentOptionsForAdd}
          mentionCounts={mentionCounts}
          initialParentId={addChildTarget === "root" ? null : addChildTarget}
        />
      ) : null}

      {moveTarget ? (
        <MovePlaceModal
          key={moveTarget.id}
          open
          onClose={() => setMoveTargetId(null)}
          place={moveTarget}
          allPlaces={places}
          mentionCounts={mentionCounts}
          onMoved={handleMoved}
        />
      ) : null}
    </div>
  );
}
