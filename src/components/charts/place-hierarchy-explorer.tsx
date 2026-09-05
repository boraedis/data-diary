"use client";

import { useMemo, useState } from "react";
import { ChartPage } from "@/components/charts/chart-page";
import { ChartCard } from "@/components/charts/chart-card";
import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveDonut } from "@/components/charts/interactive/interactive-donut";
import { GroupByPicker, type GroupByOption } from "@/components/charts/interactive/group-by-picker";
import {
  buildTreeFromLevels,
  buildTreeFromParents,
  foldTailIntoOther,
  pruneEmptyBranches,
  type HierarchyDatum,
} from "@/lib/viz/hierarchy";
import type { PlaceHierarchyRow } from "@/lib/charts";

// PlaceHierarchyExplorer — the real InteractiveDonut (#118) consumer, and
// the reason that primitive is a Sunburst rather than a single-ring donut:
// places are this app's one genuinely deep hierarchy (country > region >
// city > neighborhood > venue, arbitrary depth via places.parentId), which
// is exactly what legacy's own `location_burst` chart plotted.
//
// Same page-owns-its-own-state shape as ExerciseMixExplorer: the filters
// row lives in ChartPage's dedicated slot above the card, so the state
// driving it has to sit above both — see that file's header comment.
//
// Two hierarchies over one fetch, because the rows are identical and only
// the grouping differs:
//  - Geography: the real places tree (parentId), the legacy chart's own view.
//  - Category: category > subcategory > place, the taxonomy legacy had
//    half-written and commented out (`structureCategories` in
//    location_burst.js) but never shipped.
// Tags and people were floated as further candidates; both are flat
// today (a person carries one tag, tags have no parent), so neither has a
// second level to drill into yet — not built rather than faked with a
// one-ring "hierarchy."

type PlaceGrouping = "geography" | "category";

const GROUPING_OPTIONS: GroupByOption<PlaceGrouping>[] = [
  { id: "geography", label: "Geography" },
  { id: "category", label: "Category" },
];

type RingCount = "1" | "2" | "3";

const RING_OPTIONS: GroupByOption<RingCount>[] = [
  { id: "1", label: "1" },
  { id: "2", label: "2" },
  { id: "3", label: "3" },
];

/** Top-level branches kept before the tail folds into "Other" in category
 * mode — `categoricalColor`'s real slot count, since those branches take
 * palette colors rather than owning one in the data. Geography mode
 * doesn't fold: its countries carry their own `places.color`. */
const CATEGORY_BRANCHES_KEPT = 5;

function buildGeographyTree(rows: PlaceHierarchyRow[]): HierarchyDatum | null {
  const tree = buildTreeFromParents(rows, {
    rootName: "All places",
    toNode: (row) => ({
      key: String(row.id),
      name: row.name,
      value: row.value,
      ...(row.alias ? { shortName: row.alias } : {}),
      // Only meaningful on a root place (see PlaceHierarchyRow.rootColor),
      // and only read there — InteractiveDonut looks the color up on a
      // node's depth-1 ancestor, so setting it on every row is harmless
      // and keeps this mapping a plain field copy.
      ...(row.rootColor ? { color: row.rootColor } : {}),
    }),
    parentKeyOf: (row) => (row.parentId === null ? null : String(row.parentId)),
  });
  return pruneEmptyBranches(tree);
}

function buildCategoryTree(rows: PlaceHierarchyRow[]): HierarchyDatum | null {
  // Only places with their own mentions take part: unlike the geography
  // tree, an unlogged place is never a required link here (its category is
  // reachable through any other place that shares it), so including them
  // would just add zero-width leaves.
  const logged = rows.filter((row) => row.value > 0);
  const tree = buildTreeFromLevels(logged, {
    rootName: "All places",
    levels: [
      { of: (row) => row.category, fallback: "Uncategorized" },
      { of: (row) => row.subcategory, fallback: "Unspecified" },
    ],
    toLeaf: (row) => ({
      key: String(row.id),
      name: row.name,
      value: row.value,
      ...(row.alias ? { shortName: row.alias } : {}),
    }),
  });
  const pruned = pruneEmptyBranches(tree);
  return pruned ? foldTailIntoOther(pruned, { keep: CATEGORY_BRANCHES_KEPT }) : null;
}

export function PlaceHierarchyExplorer({ rows }: { rows: PlaceHierarchyRow[] }) {
  const [grouping, setGrouping] = useState<PlaceGrouping>("geography");
  const [rings, setRings] = useState<RingCount>("2");

  const tree = useMemo(
    () => (grouping === "geography" ? buildGeographyTree(rows) : buildCategoryTree(rows)),
    [rows, grouping],
  );

  return (
    <ChartPage
      title="Place hierarchy"
      filters={
        <>
          <GroupByPicker value={grouping} onChange={setGrouping} options={GROUPING_OPTIONS} label="Break down by" />
          <GroupByPicker value={rings} onChange={setRings} options={RING_OPTIONS} label="Rings" />
        </>
      }
    >
      <ChartCard
        title="Place hierarchy"
        description={
          grouping === "geography"
            ? "Where your days happen, nested country to venue. Click a slice to zoom in, the center to zoom back out."
            : "Places by category and subcategory. Click a slice to zoom in, the center to zoom back out."
        }
        empty={tree === null}
      >
        {/* Not the h-[min(62vh,640px)] every other chart page here uses.
            A sunburst's radius is min(width, height), so height and width
            have to be spent together — which cuts both ways:

            - A fixed tall box wastes everything past the width on a
              phone. At 375px wide the circle can't exceed 375px across,
              so 82vh of height is a third of the card left empty.
            - A box sized only to the viewport height wastes width on a
              desktop, which is what the shared class did here.

            `aspect-square` makes height track width, so the box is only
            ever as tall as the circle can actually use; the max-height
            then stops a wide desktop card from turning into a 1200px-tall
            one. Between them the circle grows in both directions at once
            and there is no dead margin at either size. */}
        <ResponsiveChart className="aspect-square max-h-[min(82vh,900px)] min-h-[320px]" minWidth={240}>
          {({ width, height }) =>
            tree ? (
              <InteractiveDonut
                data={tree}
                width={width}
                height={height}
                visibleRings={Number(rings)}
                valueLabel="visit score"
                ariaLabel="Sunburst of logged places, nested by the selected breakdown. Click a slice to zoom into it, click the center or press Escape on a slice to zoom back out."
              />
            ) : null
          }
        </ResponsiveChart>
      </ChartCard>
    </ChartPage>
  );
}
