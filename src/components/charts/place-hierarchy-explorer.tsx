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
import { DONUT_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

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
// Three hierarchies over one fetch, because the rows are identical and only
// the grouping differs:
//  - Geography: the real places tree (parentId), the legacy chart's own view.
//  - Category: category > subcategory > place, the taxonomy legacy had
//    half-written and commented out (`structureCategories` in
//    location_burst.js) but never shipped.
//  - Metro: metro > municipality > neighborhood > venue (#227) — the same
//    real geography subtree Geography mode draws, just re-rooted: every
//    Municipality-tier place (and everything under it) is detached from
//    its country/state ancestors and regrouped under its metro instead, so
//    drilling into a metro lands on the normal city/neighborhood/location
//    hierarchy rather than a flat place list. A municipality with no
//    defined metro becomes its own top-level branch (still its full real
//    subtree) rather than folding into a shared "No metro" catch-all — see
//    buildMetroTree's own comment. `metro` is resolved server-side in
//    `getPlaceHierarchyData` (`resolvePlaceLevels`).
// Tags and people were floated as further candidates; both are flat
// today (a person carries one tag, tags have no parent), so neither has a
// second level to drill into yet — not built rather than faked with a
// one-ring "hierarchy."

type PlaceGrouping = "geography" | "category" | "metro";

const GROUPING_OPTIONS: GroupByOption<PlaceGrouping>[] = [
  { id: "geography", label: "Geography" },
  { id: "category", label: "Category" },
  { id: "metro", label: "Metro" },
];

type RingCount = "1" | "2" | "3" | "all";

/**
 * "All" is legacy's `location_sequence` view (#209/#221): every depth of
 * the hierarchy on screen at once.
 *
 * It's a mode here rather than its own page because the data, the
 * groupings and the fetch are identical — the only difference is how much
 * is drawn — and a second page would be the same chart with one prop
 * changed. Selecting it also turns **zoom off**: when every ring is already
 * visible there is nothing to zoom to, and a click that reframes the chart
 * only costs the reader the overview they picked this mode for.
 *
 * Worth knowing before using it: `InteractiveDonut` sizes rings as
 * `min(width, height) / (2 * (visibleRings + 1))`, so each extra depth
 * makes every ring thinner and labels start dropping out below the
 * primitive's visibility threshold. Deep trees will read as shape rather
 * than as text.
 */
const RING_OPTIONS: GroupByOption<RingCount>[] = [
  { id: "1", label: "1" },
  { id: "2", label: "2" },
  { id: "3", label: "3" },
  { id: "all", label: "All" },
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

/**
 * Pulls every Municipality-tier node (and its whole subtree, untouched) out
 * of a geography tree built by `buildTreeFromParents`, wherever it sits.
 * Recursion stops at an extracted node rather than descending into it — a
 * municipality's own neighborhoods/venues stay exactly as nested as
 * Geography mode draws them, only the municipality's *position* moves.
 *
 * `remainder` is what's left once every municipality is pulled out: still a
 * real (if shallower) subtree, since a Country/State node's own directly-
 * logged value has nowhere else to go — buildMetroTree hangs it under
 * "Unspecified" rather than discarding it.
 */
function extractMunicipalities(
  node: HierarchyDatum,
  subcategoryByKey: Map<string, string | null>,
): { remainder: HierarchyDatum; municipalities: HierarchyDatum[] } {
  const municipalities: HierarchyDatum[] = [];
  const remainingChildren: HierarchyDatum[] = [];
  for (const child of node.children ?? []) {
    if (subcategoryByKey.get(child.key) === "Municipality") {
      municipalities.push(child);
    } else {
      const result = extractMunicipalities(child, subcategoryByKey);
      remainingChildren.push(result.remainder);
      municipalities.push(...result.municipalities);
    }
  }
  return {
    remainder: { ...node, children: remainingChildren.length > 0 ? remainingChildren : undefined },
    municipalities,
  };
}

function buildMetroTree(rows: PlaceHierarchyRow[]): HierarchyDatum | null {
  // Unpruned, like buildGeographyTree — a Country/State node with no value
  // of its own is still the required link that gets a Municipality's real
  // subtree attached to it before extraction.
  const geoTree = buildTreeFromParents(rows, {
    rootName: "All places",
    toNode: (row) => ({
      key: String(row.id),
      name: row.name,
      value: row.value,
      ...(row.alias ? { shortName: row.alias } : {}),
    }),
    parentKeyOf: (row) => (row.parentId === null ? null : String(row.parentId)),
  });

  const subcategoryByKey = new Map(rows.map((row) => [String(row.id), row.subcategory]));
  const metroByKey = new Map(rows.map((row) => [String(row.id), row.metro]));
  const { remainder, municipalities } = extractMunicipalities(geoTree, subcategoryByKey);

  // Group extracted municipalities by metro; a municipality with no defined
  // metro becomes its own top-level branch rather than merging into a
  // shared "No metro" catch-all (#227) — a single bucket for every
  // municipality outside a handful of hand-entered metro areas was both
  // the biggest slice on the chart and, once it (or the real small metros
  // beside it) folded into "Other," a dead end to drill into.
  const metroGroups = new Map<string, HierarchyDatum[]>();
  const standaloneMunicipalities: HierarchyDatum[] = [];
  for (const municipality of municipalities) {
    const metroName = metroByKey.get(municipality.key) ?? null;
    if (metroName === null) {
      standaloneMunicipalities.push(municipality);
      continue;
    }
    const group = metroGroups.get(metroName);
    if (group) group.push(municipality);
    else metroGroups.set(metroName, [municipality]);
  }

  const topLevel: HierarchyDatum[] = [
    ...[...metroGroups.entries()].map(([metroName, children]) => ({
      key: `__metro_${metroName}__`,
      name: metroName,
      children,
    })),
    ...standaloneMunicipalities,
  ];
  if (remainder.children && remainder.children.length > 0) {
    topLevel.push({ key: "__unspecified__", name: "Unspecified", children: remainder.children });
  }

  const pruned = pruneEmptyBranches({ key: "__root__", name: "All places", children: topLevel });
  return pruned ? foldTailIntoOther(pruned, { keep: CATEGORY_BRANCHES_KEPT }) : null;
}

const TREE_BUILDERS: Record<PlaceGrouping, (rows: PlaceHierarchyRow[]) => HierarchyDatum | null> = {
  geography: buildGeographyTree,
  category: buildCategoryTree,
  metro: buildMetroTree,
};

export function PlaceHierarchyExplorer({ rows }: { rows: PlaceHierarchyRow[] }) {
  const [grouping, setGrouping] = useState<PlaceGrouping>("geography");
  const [rings, setRings] = useState<RingCount>("2");

  const tree = useMemo(() => TREE_BUILDERS[grouping](rows), [rows, grouping]);

  /** Depth of the deepest branch, so "All" draws exactly as many rings as
   * the tree actually has rather than a guessed ceiling. Measured from the
   * data because the geography tree is arbitrary-depth by design. */
  const maxDepth = useMemo(() => {
    if (!tree) return 1;
    const depthOf = (node: HierarchyDatum): number =>
      node.children && node.children.length > 0
        ? 1 + Math.max(...node.children.map(depthOf))
        : 0;
    return Math.max(1, depthOf(tree));
  }, [tree]);

  return (
    <ChartPage
      title="Place Sunburst"
      description="A zoomable donut chart that lets you explore where I spent my time."
      info={{
        interactionGuide: DONUT_INTERACTION_GUIDE,
        methodology: PLACES_METHODOLOGY,
        trackingSpan: PLACES_TRACKING_SPAN,
      }}
      filters={
        <>
          <GroupByPicker value={grouping} onChange={setGrouping} options={GROUPING_OPTIONS} label="Break down by" />
          <GroupByPicker value={rings} onChange={setRings} options={RING_OPTIONS} label="Rings" />
        </>
      }
    >
      <ChartCard empty={tree === null}>
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
                visibleRings={rings === "all" ? maxDepth : Number(rings)}
                zoomable={rings !== "all"}
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
