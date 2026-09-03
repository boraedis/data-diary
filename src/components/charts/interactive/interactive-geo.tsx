"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { useD3 } from "@/hooks/use-d3";
import { attachMarkHover } from "./marks";
import { ChartTooltip } from "./tooltip";
import { SequentialLegend } from "./legend";
import { sequentialLogScale, type ColorMode } from "@/lib/viz/color";
import { formatThousandsNumber } from "@/lib/viz/format";

// InteractiveGeo (#24) — the shared choropleth primitive. Generic over any
// GeoJSON FeatureCollection (a caller decodes its own topojson via
// topojson-client's feature() and passes the result in — this component
// has no opinion on where the geometry came from), with a per-feature
// value accessor driving a sequential fill, pan/zoom (d3.zoom, same
// mechanism InteractiveNetwork already uses), a per-region hover tooltip
// (the shared attachMarkHover + ChartTooltip pattern), click-a-region-to-
// zoom-to-its-bounds, and click-the-background-to-reset.
//
// Log-scaled fill, not linear (post-#24 feedback): a choropleth's values
// are routinely heavy-tailed (one or two regions dwarfing the rest — the
// world-visits chart's own USA/everything-else split is the case that
// prompted this), and a linear domain crushes every smaller value into
// visually the same color, leaving only the single largest region
// distinguishable. See sequentialLogScale's own doc comment in
// viz/color.ts.
//
// Click-into-subdivisions (country -> state/county drill-down) is
// explicitly future scope, split out to #107 rather than attempted here —
// it needs a real per-subdivision data source and geometry for whatever's
// being drilled into, which doesn't exist yet for any consumer of this
// primitive. Click-to-zoom-to-bounds (below) is as far as this issue's
// own click behavior goes.

// Module-level, not inline default parameter values — see
// interactive-network.tsx's own comment on why an array-literal default
// sitting in useD3's deps array is a real bug (it was recreated fresh on
// every render, including one triggered by this primitive's own `hovered`
// state, tearing the whole map down and rebuilding it on nearly every
// pointermove). Learned the hard way there; applied here from the start.
const DEFAULT_ZOOM_EXTENT: [number, number] = [1, 8];

// Reserved, in px, out of the caller-given `height` for the legend row
// below the map — a caller like ResponsiveChart's fixed h-[...] class
// gives this component a hard-capped total height (unlike
// InteractiveCalendar, which uses ResponsiveChart's auto-height mode
// instead, letting the container grow to fit content); rendering the SVG
// at the *reduced* height below, not the full one, keeps map + legend
// together within that same budget instead of the legend overflowing it.
const LEGEND_AREA_HEIGHT = 36;

export type InteractiveGeoProps<P extends GeoJsonProperties = GeoJsonProperties> = {
  features: FeatureCollection<Geometry, P>;
  width: number;
  height: number;
  /** Value for a feature — null/undefined, or <= 0 (a log scale has no
   * representation for zero/negative), renders as "no data" (a muted
   * neutral fill), distinct from a real, measured positive value. */
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
  ariaLabel = "Choropleth map. Scroll or pinch to zoom, drag to pan. Click a region to zoom into it, click the background to reset. Hover a region to see its value.",
}: InteractiveGeoProps<P>) {
  const [hovered, setHovered] = useState<{ feature: Feature<Geometry, P>; clientPos: { x: number; y: number } } | null>(
    null,
  );
  // A state-backed callback ref, not a plain useRef — see interactive-
  // hist's own comment on why this needs to be state, not a ref read
  // during render.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  // Computed here (not inside useD3 below) so the legend can read the same
  // domain/scale without duplicating the computation — same split
  // InteractiveCalendar uses. colorScale is itself stable across renders
  // that don't change domain/colorMode (useMemo), which matters: it's one
  // of useD3's deps, and an unstable reference there is exactly the #23
  // rebuild-on-every-pointermove bug this file's own module comment warns
  // about.
  const domain = useMemo<[number, number]>(() => {
    const values = features.features.map(getValue).filter((v): v is number => v != null && v > 0);
    return values.length ? [Math.min(...values), Math.max(...values)] : [1, 10];
  }, [features, getValue]);
  const colorScale = useMemo(() => sequentialLogScale(domain, colorMode), [domain, colorMode]);
  const mapHeight = Math.max(0, height - LEGEND_AREA_HEIGHT);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      if (features.features.length === 0) return;

      // geoNaturalEarth1, not geoMercator — Mercator's area distortion
      // badly overstates high-latitude countries (Greenland-reads-as-
      // Africa-sized territory) on a fill-by-magnitude map, where area
      // itself carries meaning; a whole-world choropleth should use a
      // projection that doesn't visually lie about size.
      const projection = d3.geoNaturalEarth1().fitSize([width, mapHeight], features);
      const path = d3.geoPath(projection);

      const g = svg.attr("width", width).attr("height", mapHeight).append("g");

      const regions = g
        .selectAll("path")
        .data(features.features)
        .join("path")
        .attr("d", path)
        .attr("fill", (f) => {
          const v = getValue(f);
          return v == null || v <= 0 ? "var(--muted)" : colorScale(v);
        })
        .attr("stroke", "var(--border)")
        .attr("stroke-width", 0.5);

      // Click a region to zoom to its own bounds; click the background to
      // reset back to the origin view. zoomBehavior is a variable (not
      // inlined into svg.call() the way InteractiveNetwork's zoom is)
      // specifically so these two functions can drive it programmatically
      // via .transform, not just react to user gestures.
      const zoomBehavior = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent(zoomExtent)
        .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          g.attr("transform", event.transform.toString());
        });

      function zoomToFeature(feature: Feature<Geometry, P>) {
        const [[x0, y0], [x1, y1]] = path.bounds(feature);
        const dx = x1 - x0;
        const dy = y1 - y0;
        // A feature with degenerate (zero-area) geometry can't be zoomed
        // to meaningfully — leave the view as-is rather than dividing by
        // zero below.
        if (!(dx > 0) || !(dy > 0)) return;
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        // 0.9: a little breathing room around the region's own bounds
        // rather than filling the viewport edge-to-edge.
        const scale = Math.max(zoomExtent[0], Math.min(zoomExtent[1], 0.9 / Math.max(dx / width, dy / mapHeight)));
        const transform = d3.zoomIdentity.translate(width / 2, mapHeight / 2).scale(scale).translate(-cx, -cy);
        svg.transition().duration(600).call(zoomBehavior.transform, transform);
      }

      regions.style("cursor", "pointer").on("click", function (event, f) {
        // Stops this from also reaching the background click handler
        // below (a click that lands on a region isn't also "outside every
        // region").
        event.stopPropagation();
        zoomToFeature(f);
      });

      // Clicking the background resets to the origin view. A click that
      // landed on a region stopPropagation()s above before it bubbles
      // here; a real pan gesture's click gets suppressed by d3-zoom
      // itself before it's even dispatched (d3-zoom only suppresses the
      // native click after a gesture that actually moved — see
      // interactive-network.tsx's own comment on the equivalent d3-drag
      // behavior), so this only ever fires for a true click on open
      // background.
      svg.on("click", () => {
        svg.transition().duration(600).call(zoomBehavior.transform, d3.zoomIdentity);
      });

      svg.call(zoomBehavior);

      attachMarkHover<Feature<Geometry, P>>(
        regions as unknown as d3.Selection<d3.BaseType, Feature<Geometry, P>, d3.BaseType, unknown>,
        {
          onHover: (feature, clientPos) => setHovered({ feature, clientPos }),
          onLeave: () => setHovered(null),
        },
      );
    },
    [features, width, mapHeight, getValue, colorScale, zoomExtent],
  );

  const containerRect = containerEl?.getBoundingClientRect();
  const hoveredValue = hovered ? getValue(hovered.feature) : null;
  const hoveredColor = hoveredValue != null && hoveredValue > 0 ? colorScale(hoveredValue) : undefined;

  // Log-space fraction, matching the log-scaled fill — a linear fraction
  // here would put the indicator tick in the wrong place relative to the
  // gradient bar (sampled from the same log scale's interpolator).
  const legendT =
    hoveredValue != null && hoveredValue > 0
      ? Math.min(
          1,
          Math.max(0, (Math.log(hoveredValue) - Math.log(domain[0])) / (Math.log(domain[1]) - Math.log(domain[0]) || 1)),
        )
      : null;

  return (
    // Fixed to the full `height` given (not auto-growing) — map + legend
    // share this one budget; see LEGEND_AREA_HEIGHT's own comment above.
    <div style={{ width, height }} className="flex flex-col">
      <div ref={setContainerEl} style={{ position: "relative", width, height: mapHeight }} role="img" aria-label={ariaLabel}>
        <svg ref={ref} />
        {hovered && containerRect ? (
          <ChartTooltip
            x={hovered.clientPos.x - containerRect.left}
            y={hovered.clientPos.y - containerRect.top}
            title={getLabel(hovered.feature)}
            rows={
              hoveredValue == null || hoveredValue <= 0
                ? [{ label: "no data", value: "", color: "var(--muted-foreground)", variant: "swatch" }]
                : [{ label: valueLabel, value: formatValue(hoveredValue), color: hoveredColor ?? "", variant: "swatch" }]
            }
            containerWidth={width}
          />
        ) : null}
      </div>
      <SequentialLegend domain={domain} colorScale={colorScale} formatValue={formatValue} valueT={legendT} className="pt-2" />
    </div>
  );
}
