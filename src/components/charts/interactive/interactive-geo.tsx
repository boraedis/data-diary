"use client";

import { useMemo, useState } from "react";
import * as d3 from "d3";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { useD3 } from "@/hooks/use-d3";
import { attachMarkHover, MARK_SPECS } from "./marks";
import { ChartTooltip } from "./tooltip";
import { SequentialLegend } from "./legend";
import { categoricalColor, sequentialLogScale, type ColorMode } from "@/lib/viz/color";
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
//
// Projection is a caller-supplied factory (#264), not hardcoded — this
// primitive's own default stays geoNaturalEarth1 (area-accurate at global
// scale, see its own comment below, and what every current consumer
// already renders), but a city-scale consumer (#177's per-city
// neighborhood heatmaps, via #266) should pass geoMercator instead.
//
// Correction (found after #266 shipped, via an actual rendered check —
// see #266's own PR thread): this comment used to recommend
// geoAzimuthalEqualArea for city scale, reasoning that plain Mercator's
// distortion made it "visually lie about size" the way it does at world
// scale. That reasoning doesn't transfer down to a single city's few-km
// extent: Mercator's local scale factor is latitude-dependent, but over
// an extent that small the factor is close enough to constant that no
// neighborhood ends up looking bigger or smaller *relative to another
// neighborhood in the same city* than it truly is — the exact comparison
// this codebase's "don't lie about size" rule exists to protect (see
// world-visits-chart's own USA/Greenland framing). There's no real
// equal-area benefit being bought at this scale, and chasing it cost a
// real, visible bug: geoAzimuthalEqualArea defaults to being tangent at
// [0°, 0°] unless explicitly `.rotate()`/`.center()`'d onto the data —
// this component only ever calls `.fitSize()` on whatever projection a
// caller passes, which adjusts scale/translate, never rotation — so
// Atlanta (~9,000km from the default tangent point) rendered as a badly
// sheared rhombus instead of its real shape. geoMercator has no
// equivalent centering requirement (its conformality doesn't depend on
// being tangent at the data), so `fitSize` alone renders it correctly
// for any city on Earth without this primitive needing a rotate/center
// prop at all.
const DEFAULT_PROJECTION = () => d3.geoNaturalEarth1();

// Module-level, not inline default parameter values — see
// interactive-network.tsx's own comment on why an array-literal default
// sitting in useD3's deps array is a real bug (it was recreated fresh on
// every render, including one triggered by this primitive's own `hovered`
// state, tearing the whole map down and rebuilding it on nearly every
// pointermove). Learned the hard way there; applied here from the start.
const DEFAULT_ZOOM_EXTENT: [number, number] = [1, 8];

// Smaller than interactive-network.tsx's own [3, 16] node range — a geo
// marker sits on top of an already-busy choropleth fill + legend, where
// network's nodes are the entire drawing; keeping the range modest here
// leaves the region fill underneath legible instead of paving over it.
const DEFAULT_MARKER_RADIUS_RANGE: [number, number] = [3, 10];

// Reserved, in px, out of the caller-given `height` for the legend row
// below the map — a caller like ResponsiveChart's fixed h-[...] class
// gives this component a hard-capped total height (unlike
// InteractiveCalendar, which uses ResponsiveChart's auto-height mode
// instead, letting the container grow to fit content); rendering the SVG
// at the *reduced* height below, not the full one, keeps map + legend
// together within that same budget instead of the legend overflowing it.
const LEGEND_AREA_HEIGHT = 36;

/** A point overlay drawn on top of the choropleth (#264) — e.g. a
 * visited-place marker on a city heatmap. Positioned in real geographic
 * coordinates, not pixels, so it pans/zooms in lockstep with the region
 * paths under the same d3.zoom transform. */
export type GeoMarker = {
  id: string | number;
  /** [longitude, latitude], same order GeoJSON itself uses. */
  position: [number, number];
  /** Tooltip title — typically the place's name. */
  label: string;
};

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
  /** `d3.geoProjection` factory — fitSize is applied to it here, so pass
   * an un-fit projection (e.g. `() => d3.geoMercator()`, not
   * `.fitSize(...)` already called). Defaults to geoNaturalEarth1, the
   * right call at world scale; see this module's own comment above for
   * why a city-scale caller should pass geoMercator instead — and
   * specifically not an azimuthal projection, which needs explicit
   * `.rotate()`/`.center()` onto the data that fitSize alone doesn't
   * provide. */
  projection?: () => d3.GeoProjection;
  /** Optional point overlay (e.g. visited-place markers) drawn above the
   * region fill, panning/zooming with it. Omit for a plain choropleth. */
  markers?: GeoMarker[];
  /** Marker radius scales by this if provided (bubble-map style, same
   * d3.scaleSqrt pattern interactive-network.tsx uses for node size) —
   * omit for every marker at a flat MARK_SPECS.marker.radius instead. */
  getMarkerValue?: (marker: GeoMarker) => number | null | undefined;
  markerRadiusRange?: [number, number];
  /** Marker fill — defaults to categoricalColor(0), distinct from the
   * region fill's sequential scale since a marker and a region encode two
   * different things (a specific visited place vs. an aggregate value). */
  markerColor?: string;
  formatMarkerValue?: (value: number) => string;
  /** Label for a marker's tooltip value row, e.g. "visits". Only shown
   * when getMarkerValue is also given. */
  markerValueLabel?: string;
  ariaLabel?: string;
};

/** Discriminated union so one hover state serves both layers — a marker
 * sits on top of a region and should win the tooltip while hovered, not
 * show two overlapping readouts. */
type Hovered<P extends GeoJsonProperties> =
  | { kind: "region"; feature: Feature<Geometry, P>; clientPos: { x: number; y: number } }
  | { kind: "marker"; marker: GeoMarker; clientPos: { x: number; y: number } };

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
  projection = DEFAULT_PROJECTION,
  markers,
  getMarkerValue,
  markerRadiusRange = DEFAULT_MARKER_RADIUS_RANGE,
  markerColor,
  formatMarkerValue = formatThousandsNumber,
  markerValueLabel = "value",
  ariaLabel = "Choropleth map. Scroll or pinch to zoom, drag to pan. Click a region to zoom into it, click the background to reset. Hover a region or marker to see its value.",
}: InteractiveGeoProps<P>) {
  const [hovered, setHovered] = useState<Hovered<P> | null>(null);
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
  const resolvedMarkerColor = markerColor ?? categoricalColor(0);

  // Same domain/scale split as the region fill above — computed outside
  // useD3 so nothing here needs duplicating if a future caller wants a
  // marker-size legend too. null (not an empty-range scale) when there's
  // no value accessor, or no marker has a usable value yet — the render
  // below falls back to a flat MARK_SPECS.marker.radius in that case.
  const markerRadiusScale = useMemo(() => {
    if (!markers || !getMarkerValue) return null;
    const values = markers.map(getMarkerValue).filter((v): v is number => v != null && v > 0);
    if (values.length === 0) return null;
    return d3.scaleSqrt([Math.min(...values), Math.max(...values)], markerRadiusRange);
  }, [markers, getMarkerValue, markerRadiusRange]);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      if (features.features.length === 0) return;

      const fittedProjection = projection().fitSize([width, mapHeight], features);
      const path = d3.geoPath(fittedProjection);

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
          onHover: (feature, clientPos) => setHovered({ kind: "region", feature, clientPos }),
          onLeave: () => setHovered(null),
        },
      );

      // Marker overlay (#264) — projected straight from each marker's own
      // [lng, lat] via the same fitted projection the regions use, so it
      // lands correctly regardless of which projection a caller passed.
      // Appended into the same zoom-transformed `g`, after the region
      // paths, so markers draw on top and pan/zoom in lockstep.
      if (markers && markers.length > 0) {
        const positioned = markers
          .map((marker) => ({ marker, xy: fittedProjection(marker.position) }))
          // A marker whose coordinates fall outside the projection's own
          // valid range (fittedProjection returns null) can't be placed —
          // drop it rather than plotting at a garbage position.
          .filter((entry): entry is { marker: GeoMarker; xy: [number, number] } => entry.xy != null);

        const markerNodes = g
          .selectAll("circle.geo-marker")
          .data(positioned)
          .join("circle")
          .attr("class", "geo-marker")
          .attr("cx", (d) => d.xy[0])
          .attr("cy", (d) => d.xy[1])
          .attr("r", (d) => {
            const v = getMarkerValue?.(d.marker);
            return markerRadiusScale && v != null && v > 0 ? markerRadiusScale(v) : MARK_SPECS.marker.radius;
          })
          .attr("fill", resolvedMarkerColor)
          .attr("fill-opacity", 0.85)
          .attr("stroke", "var(--card)")
          .attr("stroke-width", MARK_SPECS.marker.ringWidth);

        // Stops a marker click from also reaching the background reset
        // handler above — same reasoning as the region click handler; a
        // marker isn't zoomable to bounds the way a region is, so this
        // only suppresses the reset, it doesn't zoom anywhere.
        markerNodes.style("cursor", "pointer").on("click", (event) => {
          event.stopPropagation();
        });

        attachMarkHover<{ marker: GeoMarker; xy: [number, number] }>(
          markerNodes as unknown as d3.Selection<d3.BaseType, { marker: GeoMarker; xy: [number, number] }, d3.BaseType, unknown>,
          {
            onHover: (d, clientPos) => setHovered({ kind: "marker", marker: d.marker, clientPos }),
            onLeave: () => setHovered(null),
          },
        );
      }
    },
    [
      features,
      width,
      mapHeight,
      getValue,
      colorScale,
      zoomExtent,
      projection,
      markers,
      getMarkerValue,
      markerRadiusScale,
      resolvedMarkerColor,
    ],
  );

  const containerRect = containerEl?.getBoundingClientRect();
  const hoveredValue = hovered?.kind === "region" ? getValue(hovered.feature) : null;
  const hoveredColor = hoveredValue != null && hoveredValue > 0 ? colorScale(hoveredValue) : undefined;
  const hoveredMarkerValue = hovered?.kind === "marker" ? (getMarkerValue?.(hovered.marker) ?? null) : null;

  // Log-space fraction, matching the log-scaled fill — a linear fraction
  // here would put the indicator tick in the wrong place relative to the
  // gradient bar (sampled from the same log scale's interpolator). Only
  // meaningful for a region hover — a hovered marker doesn't move the
  // region-fill legend's own indicator.
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
            title={hovered.kind === "region" ? getLabel(hovered.feature) : hovered.marker.label}
            rows={
              hovered.kind === "region"
                ? hoveredValue == null || hoveredValue <= 0
                  ? [{ label: "no data", value: "", color: "var(--muted-foreground)", variant: "swatch" }]
                  : [{ label: valueLabel, value: formatValue(hoveredValue), color: hoveredColor ?? "", variant: "swatch" }]
                : hoveredMarkerValue == null
                  ? [{ label: "no data", value: "", color: "var(--muted-foreground)", variant: "swatch" }]
                  : [
                      {
                        label: markerValueLabel,
                        value: formatMarkerValue(hoveredMarkerValue),
                        color: resolvedMarkerColor,
                        variant: "swatch",
                      },
                    ]
            }
            containerWidth={width}
          />
        ) : null}
      </div>
      <SequentialLegend domain={domain} colorScale={colorScale} formatValue={formatValue} valueT={legendT} className="pt-2" />
    </div>
  );
}
