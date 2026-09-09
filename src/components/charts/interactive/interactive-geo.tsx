"use client";

import { useCallback, useMemo, useState } from "react";
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
// Click-into-subdivisions (#107) is now real, via the optional
// `resolveDrilldown` prop: a caller returns the next `GeoLevel` down for a
// clicked feature (or a promise of one, so a big geometry file can be
// lazily imported at the moment it's first needed rather than shipped
// with the page), and this component keeps the level stack, renders the
// breadcrumb back out, and resets the zoom on every level change. A
// caller that passes nothing, or returns null for a given feature, keeps
// exactly the old behavior: click zooms to that feature's bounds. That
// fallback is what lets one map mix the two — on the world map only the
// US drills anywhere, and every other country still just zooms.
//
// The level stack is transient client state, deliberately: no query
// params, no shareable deep link (#107's own "URL state" decision), same
// as the zoom/pan transform this component has always kept in the DOM.
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

// Reserved for the drill-down breadcrumb row above the map, on the same
// budget-sharing logic as LEGEND_AREA_HEIGHT — and only subtracted when a
// caller actually passes `resolveDrilldown`, so a plain choropleth's map
// area is exactly what it was before drill-down existed.
const BREADCRUMB_AREA_HEIGHT = 28;

/** A feature as the drill-down machinery sees it — properties erased to
 * the base GeoJSON type, since one chain's levels legitimately carry
 * different property shapes (a country's `{name}` and a county's
 * `{name, state}` aren't the same type). Each level's own accessors are
 * built alongside its own features by `geoLevel` below, so the erasure
 * never actually loses anything at the point it matters. */
export type GeoFeature = Feature<Geometry, GeoJsonProperties>;

/** One level of a drill-down chain: the geometry to draw, plus the
 * accessors that read it. Bundled together deliberately — features and
 * their accessors are only ever meaningful as a pair, and keeping them in
 * one object is what makes it impossible for this component to render one
 * level's polygons through another level's `getValue`. */
export type GeoLevel = {
  /** Stable identity, used as the breadcrumb's React key. */
  key: string;
  /** Breadcrumb label for this level, e.g. "Georgia". */
  label: string;
  features: FeatureCollection<Geometry, GeoJsonProperties>;
  getValue: (feature: GeoFeature) => number | null | undefined;
  getLabel: (feature: GeoFeature) => string;
  /** Defaults to the parent level's projection when omitted — a chain
   * that stays in one part of the world (US states -> counties) usually
   * wants the same one the whole way down. */
  projection?: () => d3.GeoProjection;
  valueLabel?: string;
  ariaLabel?: string;
};

/**
 * Builds a `GeoLevel` from properly-typed features and accessors, erasing
 * the property type at the boundary.
 *
 * The cast is the point of this function, and it's safe in a way a bare
 * `as` at a call site wouldn't be: everything it erases travels together.
 * A level's `getValue`/`getLabel` are written against the very
 * FeatureCollection handed in beside them, and nothing downstream ever
 * pairs one level's features with another's accessors — the component
 * reads whichever level is active as a single unit. The cast has to go
 * through `unknown` because accessor parameters are contravariant under
 * `strictFunctionTypes`: `(f: Feature<Geometry, CountyProperties>) => x`
 * is genuinely not a subtype of `(f: GeoFeature) => x`, even though
 * calling it only ever with that level's own features is sound.
 */
export function geoLevel<P extends GeoJsonProperties>(spec: {
  key: string;
  label: string;
  features: FeatureCollection<Geometry, P>;
  getValue: (feature: Feature<Geometry, P>) => number | null | undefined;
  getLabel: (feature: Feature<Geometry, P>) => string;
  projection?: () => d3.GeoProjection;
  valueLabel?: string;
  ariaLabel?: string;
}): GeoLevel {
  return spec as unknown as GeoLevel;
}

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
   * region fill, panning/zooming with it. Omit for a plain choropleth.
   * Rendered at a constant *screen* size regardless of zoom level (each
   * marker's radius/stroke is counter-scaled by the current zoom
   * transform's own k on every zoom tick) — a marker that grew along with
   * the map as you zoomed in used to end up covering more of it, exactly
   * backwards from what zooming in should do. */
  markers?: GeoMarker[];
  /** Marker radius scales by this if provided (bubble-map style, same
   * d3.scaleSqrt pattern interactive-network.tsx uses for node size) —
   * omit for every marker at a flat MARK_SPECS.marker.radius instead.
   * Still drives the tooltip's value row even when scaleMarkersByValue is
   * false — the two are independent (a chart can show real values on
   * hover without using them to size the dots). */
  getMarkerValue?: (marker: GeoMarker) => number | null | undefined;
  markerRadiusRange?: [number, number];
  /** Whether marker radius actually scales by getMarkerValue — default
   * true. A chart plotting many markers at once (#177's city-heatmap,
   * every visited place rather than a curated top handful) wants uniform,
   * unobtrusive dots instead: size-by-frequency reads as "these few are
   * what matter" for a curated top-N, but as visual noise once every
   * marker is shown. Set false for that case; getMarkerValue's tooltip
   * role is unaffected. */
  scaleMarkersByValue?: boolean;
  /** Marker fill — defaults to categoricalColor(0), distinct from the
   * region fill's sequential scale since a marker and a region encode two
   * different things (a specific visited place vs. an aggregate value). */
  markerColor?: string;
  formatMarkerValue?: (value: number) => string;
  /** Label for a marker's tooltip value row, e.g. "visits". Only shown
   * when getMarkerValue is also given. */
  markerValueLabel?: string;
  /** Optional second tooltip row for a marker, below the value row — a
   * plain string, not a magnitude (e.g. #177's city-heatmap uses this for
   * which neighborhood the place resolves to). Return an explicit string
   * like "not mapped" to actively flag a gap rather than returning null —
   * a missing row and "no match found" read very differently when the
   * whole point is spotting a mismatch from the tooltip. Return null only
   * for "this row doesn't apply to this marker at all". */
  getMarkerSecondaryValue?: (marker: GeoMarker) => string | null;
  /** Label for the secondary row, e.g. "neighborhood". */
  markerSecondaryLabel?: string;
  ariaLabel?: string;
  /** Next level down for a clicked feature, or null to fall back to
   * zoom-to-bounds for that feature (#107). `depth` is 0 while the root
   * level from this component's own props is showing, 1 one level in, and
   * so on — a chain that goes country -> state -> county switches on it.
   *
   * May return a promise: county geometry is several times the size of
   * everything else a chart page loads, and making it awaitable is what
   * lets a caller `import()` it on the first drill-in instead of bundling
   * it into the initial page. While one is pending, clicks are ignored
   * and the breadcrumb row says so. */
  resolveDrilldown?: (feature: GeoFeature, depth: number) => GeoLevel | null | Promise<GeoLevel | null>;
  /** Breadcrumb label for the root level, e.g. "World" or "United
   * States". Only rendered when `resolveDrilldown` is also given. */
  rootLabel?: string;
};

/** Discriminated union so one hover state serves both layers — a marker
 * sits on top of a region and should win the tooltip while hovered, not
 * show two overlapping readouts.
 *
 * Holds a `GeoFeature` rather than this component's own `P`: once a chart
 * can drill from countries into counties, the hovered feature isn't
 * necessarily the root level's property shape any more. It's read back
 * only through the active level's own `getLabel`/`getValue`, which is
 * where the real typing lives. */
type Hovered =
  | { kind: "region"; feature: GeoFeature; clientPos: { x: number; y: number } }
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
  scaleMarkersByValue = true,
  markerColor,
  formatMarkerValue = formatThousandsNumber,
  markerValueLabel = "value",
  getMarkerSecondaryValue,
  markerSecondaryLabel = "detail",
  ariaLabel = "Choropleth map. Scroll or pinch to zoom, drag to pan. Click a region to zoom into it, click the background to reset. Hover a region or marker to see its value.",
  resolveDrilldown,
  rootLabel = "All",
}: InteractiveGeoProps<P>) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  // Levels drilled into below the root, deepest last. Empty means the
  // root level (this component's own `features`/`getValue`/`getLabel`
  // props) is showing.
  const [stack, setStack] = useState<GeoLevel[]>([]);
  // Only ever true while an async resolveDrilldown is in flight. Kept out
  // of useD3's deps on purpose: it drives the breadcrumb row's text, and
  // putting it in deps would tear down and rebuild the entire SVG twice
  // per drill-in for a caption change.
  const [drilling, setDrilling] = useState(false);
  // A state-backed callback ref, not a plain useRef — see interactive-
  // hist's own comment on why this needs to be state, not a ref read
  // during render.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  // The root level, expressed as a GeoLevel so everything below this line
  // reads one shape whether or not a drill-down is configured — rather
  // than every use site branching on "props or stack top?".
  const rootLevel = useMemo<GeoLevel>(
    () =>
      geoLevel<P>({
        key: "__root__",
        label: rootLabel,
        features,
        getValue,
        getLabel,
        projection,
        valueLabel,
        ariaLabel,
      }),
    [rootLabel, features, getValue, getLabel, projection, valueLabel, ariaLabel],
  );
  const active = stack.length > 0 ? stack[stack.length - 1] : rootLevel;
  // Falls back up the stack, then to the root — a level that doesn't name
  // its own projection keeps drawing in its parent's (see GeoLevel's own
  // comment: a US state's counties want exactly the projection the state
  // map already used).
  const activeProjection =
    active.projection ?? [...stack].reverse().find((l) => l.projection)?.projection ?? projection;

  // Computed here (not inside useD3 below) so the legend can read the same
  // domain/scale without duplicating the computation — same split
  // InteractiveCalendar uses. colorScale is itself stable across renders
  // that don't change domain/colorMode (useMemo), which matters: it's one
  // of useD3's deps, and an unstable reference there is exactly the #23
  // rebuild-on-every-pointermove bug this file's own module comment warns
  // about.
  //
  // Keyed off the *active* level, so drilling into a state rescales the
  // fill to that state's own counties. Deliberately not a domain shared
  // across levels: a county holding 5 days next to one holding 300 is the
  // comparison the drilled-in view exists to make, and inheriting the
  // national domain (where Fulton's ~1900 sets the ceiling) would flatten
  // every county in most states into one indistinguishable color.
  const domain = useMemo<[number, number]>(() => {
    const values = active.features.features.map(active.getValue).filter((v): v is number => v != null && v > 0);
    return values.length ? [Math.min(...values), Math.max(...values)] : [1, 10];
  }, [active]);
  const colorScale = useMemo(() => sequentialLogScale(domain, colorMode), [domain, colorMode]);
  const breadcrumbHeight = resolveDrilldown ? BREADCRUMB_AREA_HEIGHT : 0;
  const mapHeight = Math.max(0, height - LEGEND_AREA_HEIGHT - breadcrumbHeight);
  const resolvedMarkerColor = markerColor ?? categoricalColor(0);

  const drillTo = useCallback((level: GeoLevel) => {
    // Hover is cleared with the same setState batch that swaps the level:
    // the tooltip is showing a feature that's about to stop existing, and
    // leaving it up for a frame reads as the new map having a stale
    // readout attached to it.
    setHovered(null);
    setStack((current) => [...current, level]);
  }, []);

  /** Truncate the stack to `depth` levels — 0 is the root. Drives the
   * breadcrumb links back out. */
  const drillUpTo = useCallback((depth: number) => {
    setHovered(null);
    setStack((current) => (depth >= current.length ? current : current.slice(0, depth)));
  }, []);

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
      if (active.features.features.length === 0) return;

      // d3-zoom keeps the current transform on the DOM node itself (the
      // `__zoom` expando), and useD3 only clears the <svg>'s *children* —
      // the element itself survives every rebuild. Without this reset, a
      // transform from the previous drawing leaks into the next one: the
      // freshly-appended <g> below has no transform attribute, so the map
      // *looks* unzoomed while d3-zoom still believes it's zoomed in, and
      // the first scroll or drag afterwards snaps the view. Latent before
      // drill-down (it needed a features change, e.g. switching city on
      // the city heatmap while zoomed); unmissable once every drill-in
      // and breadcrumb click swaps the geometry.
      svg.property("__zoom", d3.zoomIdentity);

      const fittedProjection = activeProjection().fitSize([width, mapHeight], active.features);
      const path = d3.geoPath(fittedProjection);

      const g = svg.attr("width", width).attr("height", mapHeight).append("g");

      // Assigned once the marker block below runs (still before any zoom
      // event can fire, since both happen synchronously in this same
      // effect) — declared here, not `const` inside that block, so the
      // zoom handler's closure can reach the current selection to
      // counter-scale it on every tick. Stays null for a markerless map.
      let markerNodes: d3.Selection<SVGCircleElement, { marker: GeoMarker; xy: [number, number] }, d3.BaseType, unknown> | null = null;
      function markerRadius(d: { marker: GeoMarker }) {
        const v = getMarkerValue?.(d.marker);
        return scaleMarkersByValue && markerRadiusScale && v != null && v > 0 ? markerRadiusScale(v) : MARK_SPECS.marker.radius;
      }

      const regions = g
        .selectAll("path")
        .data(active.features.features)
        .join("path")
        .attr("d", path)
        .attr("fill", (f) => {
          const v = active.getValue(f);
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
          // Counter-scale markers by the same factor the transform above
          // just applied, so their on-screen size stays constant instead
          // of growing with the map — see `markers`' own prop comment.
          const k = event.transform.k;
          markerNodes?.attr("r", (d) => markerRadius(d) / k).attr("stroke-width", MARK_SPECS.marker.ringWidth / k);
        });

      function zoomToFeature(feature: GeoFeature) {
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
        if (!resolveDrilldown) {
          zoomToFeature(f);
          return;
        }
        // `depth` is read from the stack length captured when this
        // drawing was built, which is exactly the depth being clicked —
        // a level swap rebuilds the whole SVG, so a handler can never
        // outlive the level it was attached to.
        const next = resolveDrilldown(f, stack.length);
        if (next === null) {
          // This feature doesn't drill anywhere (a non-US country on the
          // world map, a county at the bottom of the chain) — keep the
          // pre-#107 behavior rather than doing nothing on click.
          zoomToFeature(f);
          return;
        }
        if (!(next instanceof Promise)) {
          drillTo(next);
          return;
        }
        setDrilling(true);
        next
          .then((level) => {
            if (level) drillTo(level);
            else zoomToFeature(f);
          })
          // A failed geometry import shouldn't leave the map stuck
          // showing "Loading…" forever with clicks swallowed; fall back
          // to the zoom the click would have done without a drill-down
          // configured at all.
          .catch(() => zoomToFeature(f))
          .finally(() => setDrilling(false));
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

      attachMarkHover<GeoFeature>(regions as unknown as d3.Selection<d3.BaseType, GeoFeature, d3.BaseType, unknown>, {
        onHover: (feature, clientPos) => setHovered({ kind: "region", feature, clientPos }),
        onLeave: () => setHovered(null),
      });

      // Marker overlay (#264) — projected straight from each marker's own
      // [lng, lat] via the same fitted projection the regions use, so it
      // lands correctly regardless of which projection a caller passed.
      // Appended into the same zoom-transformed `g`, after the region
      // paths, so markers draw on top and pan/zoom in lockstep.
      //
      // Root level only: `markers` is one flat list belonging to the map
      // a caller handed in, and a drilled-in level is showing different
      // geometry at a different scale that those markers were never
      // chosen for. Re-projecting them onto a single county would either
      // scatter dots outside its borders or crowd every one of them into
      // it. A drill-down chain that wants its own per-level markers should
      // say so on GeoLevel rather than have this silently reuse the root's.
      if (stack.length === 0 && markers && markers.length > 0) {
        const positioned = markers
          .map((marker) => ({ marker, xy: fittedProjection(marker.position) }))
          // A marker whose coordinates fall outside the projection's own
          // valid range (fittedProjection returns null) can't be placed —
          // drop it rather than plotting at a garbage position.
          .filter((entry): entry is { marker: GeoMarker; xy: [number, number] } => entry.xy != null);

        markerNodes = g
          .selectAll<SVGCircleElement, { marker: GeoMarker; xy: [number, number] }>("circle.geo-marker")
          .data(positioned)
          .join("circle")
          .attr("class", "geo-marker")
          .attr("cx", (d) => d.xy[0])
          .attr("cy", (d) => d.xy[1])
          .attr("r", markerRadius)
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
      // `active` replaces the old features/getValue pair — it carries
      // both, and changes identity exactly when the drawn level does.
      // `stack` is here too (not just `active`) because the click handler
      // closes over stack.length for the drill depth, and the marker
      // block reads it to decide whether to draw at all.
      active,
      stack,
      width,
      mapHeight,
      colorScale,
      zoomExtent,
      activeProjection,
      resolveDrilldown,
      drillTo,
      markers,
      getMarkerValue,
      markerRadiusScale,
      scaleMarkersByValue,
      resolvedMarkerColor,
    ],
  );

  const containerRect = containerEl?.getBoundingClientRect();
  const hoveredValue = hovered?.kind === "region" ? active.getValue(hovered.feature) : null;
  const hoveredColor = hoveredValue != null && hoveredValue > 0 ? colorScale(hoveredValue) : undefined;
  const hoveredMarkerValue = hovered?.kind === "marker" ? (getMarkerValue?.(hovered.marker) ?? null) : null;
  const hoveredMarkerSecondary = hovered?.kind === "marker" ? (getMarkerSecondaryValue?.(hovered.marker) ?? null) : null;

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
      {resolveDrilldown ? (
        <nav
          aria-label="Map drill-down"
          style={{ height: BREADCRUMB_AREA_HEIGHT }}
          className="flex items-center gap-1 overflow-hidden text-xs text-muted-foreground"
        >
          {[rootLevel, ...stack].map((level, depth) => {
            const isCurrent = depth === stack.length;
            return (
              <span key={level.key} className="flex min-w-0 items-center gap-1">
                {depth > 0 ? (
                  <span aria-hidden className="shrink-0 opacity-60">
                    /
                  </span>
                ) : null}
                {isCurrent ? (
                  // The level you're looking at is a label, not a link —
                  // aria-current so a screen reader gets the same "you are
                  // here" the visual weight conveys.
                  <span aria-current="location" className="truncate font-medium text-foreground">
                    {level.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => drillUpTo(depth)}
                    className="truncate rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {level.label}
                  </button>
                )}
              </span>
            );
          })}
          {drilling ? (
            // aria-live so the wait is announced rather than only shown —
            // loading a county file is the one interaction here that
            // isn't instant.
            <span role="status" className="shrink-0 pl-2 opacity-70">
              Loading…
            </span>
          ) : null}
        </nav>
      ) : null}
      <div
        ref={setContainerEl}
        style={{ position: "relative", width, height: mapHeight }}
        role="img"
        aria-label={active.ariaLabel ?? ariaLabel}
      >
        <svg ref={ref} />
        {hovered && containerRect ? (
          <ChartTooltip
            x={hovered.clientPos.x - containerRect.left}
            y={hovered.clientPos.y - containerRect.top}
            title={hovered.kind === "region" ? active.getLabel(hovered.feature) : hovered.marker.label}
            rows={
              hovered.kind === "region"
                ? hoveredValue == null || hoveredValue <= 0
                  ? [{ label: "no data", value: "", color: "var(--muted-foreground)", variant: "swatch" }]
                  : [
                      {
                        label: active.valueLabel ?? valueLabel,
                        value: formatValue(hoveredValue),
                        color: hoveredColor ?? "",
                        variant: "swatch",
                      },
                    ]
                : [
                    ...(hoveredMarkerValue == null
                      ? [{ label: "no data", value: "", color: "var(--muted-foreground)", variant: "swatch" as const }]
                      : [
                          {
                            label: markerValueLabel,
                            value: formatMarkerValue(hoveredMarkerValue),
                            color: resolvedMarkerColor,
                            variant: "swatch" as const,
                          },
                        ]),
                    ...(hoveredMarkerSecondary != null
                      ? [
                          {
                            label: markerSecondaryLabel,
                            value: hoveredMarkerSecondary,
                            color: resolvedMarkerColor,
                            variant: "swatch" as const,
                          },
                        ]
                      : []),
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
