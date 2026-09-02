"use client";

import { ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveNetwork } from "@/components/charts/interactive/interactive-network";
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
  return (
    <ResponsiveChart className="h-[min(62vh,640px)] min-h-[320px]" minWidth={360}>
      {({ width, height }) => (
        <InteractiveNetwork
          nodes={data.nodes.map((n) => ({ id: n.id, label: n.name, count: n.count }))}
          edges={data.edges}
          width={width}
          height={height}
          countLabel={(n) => `day${n === 1 ? "" : "s"}`}
          ariaLabel="People co-occurrence network. Hover a person to see their name and day count; drag to reposition."
        />
      )}
    </ResponsiveChart>
  );
}
