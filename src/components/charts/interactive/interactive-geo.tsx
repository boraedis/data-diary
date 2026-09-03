"use client";

import { useState } from "react";
import * as d3 from "d3";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { useD3 } from "@/hooks/use-d3";
import { attachMarkHover } from "./marks";
import { ChartTooltip } from "./tooltip";
import { sequentialScale, type ColorMode } from "@/lib/viz/color";
import { formatThousandsNumber } from "@/lib/viz/format";

// InteractiveGeo (#24) — the shared choropleth primitive. Generic over any
// GeoJSON FeatureCollection (a caller decodes its own topojson via
// topojson-client's feature() and passes the result in — this component
// has no opinion on where the geometry came from), with a per-feature
// value accessor driving a sequential fill. Deliberately the heaviest of
// the Interactive* primitives per #24's own framing — pan/zoom (d3.zoom,
// same mechanism InteractiveNetwork/InteractiveLine already use) and a
// per-region hover tooltip (the shared attachMarkHover + ChartTooltip
// pattern every other primitive uses) are the two interactive affordances
// the issue calls for; nothing else.

// Module-level, not inline default parameter values — see
// interactive-network.tsx's own comment on why an array-literal default
// sitting in useD3's deps array is a real bug (it was recreated fresh on
// every render, including one triggered by this primitive's own `hovered`
// state, tearing the whole map down and rebuilding it on nearly every
// pointermove). Learned the hard way there; applied here from the start.
const DEFAULT_ZOOM_EXTENT: [number, number] = [1, 8];

export type InteractiveGeoProps<P extends GeoJsonProperties = GeoJsonProperties> = {
  features: FeatureCollection<Geometry, P>;
  width: number;
  height: number;
  /** Value for a feature — null/undefined renders as "no data" (a muted
   * neutral fill), distinct from a real, measured 0. */
  getValue: (feature: Feature<Geometry, P>) => number | null | undefined;
  /** Label for a feature's tooltip title — typically its name. */
  getLabel: (feature: Feature<Geometry, P>) => string;
  formatValue?: (value: number) => string;
  /** Label for the tooltip's value row, e.g. "days". Defaults to the
   * generic "value". */
  valueLabel?: string;
  colorMode?: ColorMode;
  zoomExtent?: [number, number];
  ariaLabel?: string;
};

export function InteractiveGeo<P extends GeoJsonProperties = GeoJsonProperties>({
  features,
  width,
  height,
  getValue,
  getLabel,
  formatValue = formatThousandsNumber,
  valueLabel = "value",
  colorMode = "light",
  zoomExtent = DEFAULT_ZOOM_EXTENT,
  ariaLabel = "Choropleth map. Scroll or pinch to zoom, drag to pan. Hover a region to see its value.",
}: InteractiveGeoProps<P>) {
  const [hovered, setHovered] = useState<{ feature: Feature<Geometry, P>; clientPos: { x: number; y: number } } | null>(
    null,
  );
  // A state-backed callback ref, not a plain useRef — see interactive-
  // hist's own comment on why this needs to be state, not a ref read
  // during render.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      if (features.features.length === 0) return;

      const values = features.features.map(getValue).filter((v): v is number => v != null);
      const domain: [number, number] = values.length ? [Math.min(...values), Math.max(...values)] : [0, 1];
      const colorScale = sequentialScale(domain, colorMode);

      // geoNaturalEarth1, not geoMercator — Mercator's area distortion
      // badly overstates high-latitude countries (Greenland-reads-as-
      // Africa-sized territory) on a fill-by-magnitude map, where area
      // itself carries meaning; a whole-world choropleth should use a
      // projection that doesn't visually lie about size.
      const projection = d3.geoNaturalEarth1().fitSize([width, height], features);
      const path = d3.geoPath(projection);

      const g = svg.attr("width", width).attr("height", height).append("g");

      const regions = g
        .selectAll("path")
        .data(features.features)
        .join("path")
        .attr("d", path)
        .attr("fill", (f) => {
          const v = getValue(f);
          return v == null ? "var(--muted)" : colorScale(v);
        })
        .attr("stroke", "var(--border)")
        .attr("stroke-width", 0.5);

      attachMarkHover<Feature<Geometry, P>>(
        regions as unknown as d3.Selection<d3.BaseType, Feature<Geometry, P>, d3.BaseType, unknown>,
        {
          onHover: (feature, clientPos) => setHovered({ feature, clientPos }),
          onLeave: () => setHovered(null),
        },
      );

      // Direct zoom/pan — same d3.zoom-on-svg-transforming-a-<g> pattern
      // as InteractiveNetwork; a map has no axis-like "domain" to rescale,
      // just a viewport onto the same fixed projected geometry.
      svg.call(
        d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent(zoomExtent)
          .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
            g.attr("transform", event.transform.toString());
          }),
      );
    },
    [features, width, height, getValue, colorMode, zoomExtent],
  );

  const containerRect = containerEl?.getBoundingClientRect();
  const hoveredValue = hovered ? getValue(hovered.feature) : null;

  return (
    <div ref={setContainerEl} style={{ position: "relative", width, height }} role="img" aria-label={ariaLabel}>
      <svg ref={ref} />
      {hovered && containerRect ? (
        <ChartTooltip
          x={hovered.clientPos.x - containerRect.left}
          y={hovered.clientPos.y - containerRect.top}
          title={getLabel(hovered.feature)}
          rows={
            hoveredValue == null
              ? [{ label: "no data", value: "", color: "var(--muted-foreground)" }]
              : [{ label: valueLabel, value: formatValue(hoveredValue), color: "var(--muted-foreground)" }]
          }
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}
