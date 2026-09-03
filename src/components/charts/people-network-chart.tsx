"use client";

import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveNetwork } from "@/components/charts/interactive/interactive-network";
import { categoricalColor } from "@/lib/viz/color";
import type { PeopleNetworkData } from "@/lib/charts";

/** A force-directed co-occurrence graph of the people most often logged
 * together — the legacy `people_network` chart, simplified from a live
 * `forceSimulation` + `setInterval` re-tick loop into a one-time layout
 * (drag a node to reposition it; nothing else moves in response, unlike
 * the legacy live physics — a deliberate simplification, not an
 * oversight). Node size = how many days that person was logged; edge
 * thickness = how many days two people were logged together. Now a thin
 * wrapper around the shared InteractiveNetwork primitive (#23) instead of
 * its own bespoke force-simulation implementation. */
export function PeopleNetworkChart({ data }: { data: PeopleNetworkData }) {
  // Looked up by id inside the `color` callback below rather than
  // threading a `color` field through InteractiveNetwork's own NetworkNode
  // type, which stays generic (id/label/count) and shouldn't need to know
  // "color" is one of the fields a caller might care about.
  const colorByPersonId = new Map<string | number, string | null>(data.nodes.map((n) => [n.id, n.color]));

  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" minWidth={360}>
      {({ width, height }) => (
        <InteractiveNetwork
          nodes={data.nodes.map((n) => ({ id: n.id, label: n.name, count: n.count }))}
          edges={data.edges}
          width={width}
          height={height}
          // Each person's own tag color, matching how they're colored
          // everywhere else in the app; untagged people (or an untagged
          // color) fall back to the toolkit's default categorical color
          // rather than a hole in the graph.
          color={(n) => colorByPersonId.get(n.id) ?? categoricalColor(0)}
          // A single shared day doesn't mean much on its own at this node
          // count — only draw an edge once two people have actually been
          // logged together more than once, so the graph reads as real
          // relationships rather than a fully-connected haze.
          minEdgeWeight={2}
          countLabel={(n) => `day${n === 1 ? "" : "s"}`}
          ariaLabel="People co-occurrence network. Hover a person to see their name and day count; drag to reposition; click a person to highlight who they're most often logged with."
        />
      )}
    </ResponsiveChart>
  );
}
