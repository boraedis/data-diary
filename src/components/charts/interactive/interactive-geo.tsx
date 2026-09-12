"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import { useD3 } from "@/hooks/use-d3";
import { attachMarkHover, MARK_SPECS } from "./marks";
import { ChartTooltip } from "./tooltip";
import { SequentialLegend } from "./legend";
import { categoricalColor, sequentialLogScale, travelledFill, type ColorMode } from "@/lib/viz/color";
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
// Click-into-subdivisions (#107) is real, via the optional
// `resolveExpansion` prop: a caller returns the subdivisions of a clicked
// region (or a promise of them, so a big geometry file can be lazily
// imported at the moment it's first needed rather than shipped with the
// page), and this component swaps that one region's polygon for them and
// zooms to it.
//
// **Expansion happens in place, not as a level swap.** The clicked
// region's own polygon is removed and its subdivisions are drawn through
// the *same fitted projection*, so they land exactly inside the outline
// that was there a moment ago, while every neighbouring region stays on
// screen at its own level. Nothing is re-fitted, nothing jumps, and the
// only visual change is a zoom transform plus one polygon becoming many.
//
// That's a deliberate correction of this feature's first implementation,
// which replaced the entire map with the drilled-in level and offered a
// breadcrumb back out. It worked, but it threw away the thing that makes
// a map a map: after drilling into Georgia you could no longer see — or
// click — Alabama. Expanding in place means a neighbour is always one
// click away and the reader never loses the surrounding context.
//
// Exactly one region is open at a time, and every click is a complete
// gesture — there is no chrome to operate, and nothing needs closing
// before the next thing can be opened:
//
//   click another expandable region  -> that one opens, the old one closes
//   click a region that can't expand -> the old one closes, camera goes there
//   click a subdivision of the open one -> stays open, camera goes there
//   click open background            -> closes and zooms back out, one click
//
// The third line is the deliberate exception: a county belongs to the
// state you drilled into, so clicking it is staying inside rather than
// leaving. Collapsing there would make the map appear to undo your work.
// See the `expansion` state below for why accumulating open regions
// turned out worse than replacing them.
//
// A caller that passes nothing, or returns null for a given feature,
// keeps exactly the old behavior: click zooms to that feature's bounds.
// That fallback is what lets one map mix the two — on the world map only
// the US expands, and every other country still just zooms.
//
// Which regions are expanded is transient client state, deliberately: no
// query params, no shareable deep link (#107's own "URL state" decision),
// same as the zoom/pan transform this component has always kept in the DOM.
//
// Projection is a caller-supplied factory (#264), not hardcoded. The
// default is now geoMercator, changed from geoNaturalEarth1 once this
// became a map you expand and zoom into rather than one you only look at.
//
// The reason is conformality. geoNaturalEarth1 is a compromise
// pseudocylindrical projection: it keeps areas honest and looks right at
// a glance, but it shears badly toward the edges of its frame — Alaska,
// Russia's far east and New Zealand all arrive visibly skewed, leaning
// away from the centre. That's tolerable on a static world map, where
// nobody is studying an individual country's outline. It stops being
// tolerable the moment you can click a country, break it into
// subdivisions and zoom into them, because now the reader *is* studying
// shapes, and studying them exactly where the distortion is worst.
//
// geoMercator is conformal: it preserves local shape everywhere, at every
// scale, which is precisely why every zoomable web map in existence
// (Google, OSM, Mapbox) is built on it. A drilled-into region looks like
// itself no matter where on the map it sits.
//
// The cost is real and worth stating plainly: Mercator inflates area with
// latitude, so Greenland reads far larger than it is and the poles can't
// be drawn at all (d3 clips them). This file used to argue the other side
// of that trade — see the geoAzimuthalEqualArea correction below, which
// leans on a "don't lie about size" rule. That rule hasn't been
// abandoned: it's that on a *choropleth* the quantity is carried by
// colour, not by area, so an inflated Greenland misleads much less than a
// sheared Alaska does when shape is the thing you're inspecting. A caller
// that genuinely needs area comparison should pass geoEqualEarth.
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
const DEFAULT_PROJECTION = () => d3.geoMercator();

// Module-level, not inline default parameter values — see
// interactive-network.tsx's own comment on why an array-literal default
// sitting in useD3's deps array is a real bug (it was recreated fresh on
// every render, including one triggered by this primitive's own `hovered`
// state, tearing the whole map down and rebuilding it on nearly every
// pointermove). Learned the hard way there; applied here from the start.
// 64x, not the 8x this shipped with. 8 was set when the only things on a
// map were countries and states, where it's plenty; it stopped being
// enough once a map could draw all 3,142 US counties (#313) or a city's
// neighborhoods (#177), where the whole point is getting close to one
// small polygon. The US is ~4,500km across and a county is tens of km, so
// 8x doesn't even bring one county to a readable size.
//
// Nothing degrades at the higher ceiling: region borders carry
// `vector-effect: non-scaling-stroke` so they hold a constant on-screen
// width however far in you go, and markers are counter-scaled by the
// transform's own k on every zoom tick. 64 also matches the scaleExtent
// InteractiveScroller and InteractiveTimeline already use.
const DEFAULT_ZOOM_EXTENT: [number, number] = [1, 64];

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

// Extra height reserved when the legend also carries discrete swatches
// (#364's "travelled through" / "no data" keys). They sit in the same
// flex row as the gradient bar and wrap below it once the map is narrow —
// which, on a hard-capped container, would push the legend out of the
// bottom rather than shrink the map. Reserving a second row's worth
// unconditionally-when-present is deterministic; measuring the wrap
// isn't available here, and guessing from `width` would have to model
// font metrics for caller-supplied labels.
const LEGEND_SWATCH_ROW_HEIGHT = 20;

/** Anything d3's own `fitSize` will take as a fit target. */
export type GeoFitTarget = Parameters<d3.GeoProjection["fitSize"]>[1];

/** A feature as the drill-down machinery sees it — properties erased to
 * the base GeoJSON type, since one chain's levels legitimately carry
 * different property shapes (a country's `{name}` and a county's
 * `{name, state}` aren't the same type). Each expansion's own accessors
 * are built alongside its own features by `geoExpansion` below, so the
 * erasure never actually loses anything at the point it matters. */
export type GeoFeature = Feature<Geometry, GeoJsonProperties>;

/** The subdivisions of one expanded region: the geometry to draw in its
 * place, plus the accessors that read it. Bundled together deliberately —
 * features and their accessors are only ever meaningful as a pair, and
 * keeping them in one object is what makes it impossible for this
 * component to render one set of polygons through another's `getValue`,
 * which matters far more here than it would for a level swap: states and
 * counties are on screen *simultaneously*, each drawn through its own
 * accessors.
 *
 * Note what's deliberately absent: a projection. Subdivisions are drawn
 * through the map's existing fitted projection, which is exactly what
 * makes them land inside the outline of the region they replaced. An
 * expansion that could pick its own projection couldn't be drawn in
 * place at all. */
export type GeoExpansion = {
  /** Stable identity for this expansion, used as a React key. */
  key: string;
  /** Label for the expanded-regions row, e.g. "Georgia". */
  label: string;
  features: FeatureCollection<Geometry, GeoJsonProperties>;
  getValue: (feature: GeoFeature) => number | null | undefined;
  getLabel: (feature: GeoFeature) => string;
  /** Whether a subdivision is "visited but unmeasured" — see the
   * component prop of the same name. Carried per-expansion rather than
   * inherited from the map, for the same reason `getValue` is: a state's
   * counties and the countries around them are on screen together and
   * answer this question from different data. */
  isTravelled?: (feature: GeoFeature) => boolean;
  /** Tooltip value label for these subdivisions, if it differs from the
   * map's own (it usually doesn't — "days" is "days" at either scale). */
  valueLabel?: string;
};

/**
 * Builds a `GeoExpansion` from properly-typed features and accessors,
 * erasing the property type at the boundary.
 *
 * The cast is the point of this function, and it's safe in a way a bare
 * `as` at a call site wouldn't be: everything it erases travels together.
 * An expansion's `getValue`/`getLabel` are written against the very
 * FeatureCollection handed in beside them, and every feature this
 * component draws carries its own accessors alongside it (see
 * `DrawnFeature`), so the two can't drift apart. The cast has to go
 * through `unknown` because accessor parameters are contravariant under
 * `strictFunctionTypes`: `(f: Feature<Geometry, CountyProperties>) => x`
 * is genuinely not a subtype of `(f: GeoFeature) => x`, even though
 * calling it only ever with that expansion's own features is sound.
 */
export function geoExpansion<P extends GeoJsonProperties>(spec: {
  key: string;
  label: string;
  features: FeatureCollection<Geometry, P>;
  getValue: (feature: Feature<Geometry, P>) => number | null | undefined;
  getLabel: (feature: Feature<Geometry, P>) => string;
  isTravelled?: (feature: Feature<Geometry, P>) => boolean;
  valueLabel?: string;
}): GeoExpansion {
  return spec as unknown as GeoExpansion;
}

/** One polygon as actually drawn: the feature, plus whichever accessors
 * belong to it. The base map's features and every expansion's features
 * end up in one flat list bound to one D3 selection, so each entry has to
 * carry its own way of being read — there is no single "current level"
 * once a state and its neighbour's counties share the screen. */
type DrawnFeature = {
  feature: GeoFeature;
  getValue: (feature: GeoFeature) => number | null | undefined;
  getLabel: (feature: GeoFeature) => string;
  isTravelled?: (feature: GeoFeature) => boolean;
  valueLabel?: string;
  /** Identity of the base feature this can expand into, or null for a
   * feature that's already a subdivision (the bottom of the chain). */
  expandableKey: string | null;
};

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
  /** Whether a feature is known-visited but has no measured value —
   * #364's third fill state, drawn in its own flat tint with its own
   * legend entry (see `travelledFill` in viz/color.ts for why the tint
   * is a cool hue rather than a paler step of the ramp).
   *
   * **Deliberately a separate accessor rather than a sentinel `getValue`
   * returns.** A magic number would enter the sequential scale's domain
   * and the legend would then present it as a measurement — inventing a
   * quantity for something whose entire premise is that no quantity was
   * recorded. Legacy did exactly that (floored these regions at 0.3 on
   * the day-count ramp); this is the fix, not a port of it.
   *
   * **A real value always wins.** A feature with a positive `getValue`
   * keeps its place on the ramp even if this returns true, so a region
   * with genuinely logged data is never downgraded to the tint by an
   * overlapping travelled record. Callers therefore don't have to
   * pre-empt the overlap themselves — see #365's containment rule, which
   * is this precedence applied at each view tier.
   *
   * Omit for a plain two-state choropleth; every pre-#364 caller does
   * and renders exactly as before. */
  isTravelled?: (feature: Feature<Geometry, P>) => boolean;
  /** Legend/tooltip wording for the `isTravelled` state. Defaults to
   * "travelled through" — this primitive's only domain-flavoured
   * default, kept overridable so a future non-travel use of the third
   * state isn't stuck with the word. */
  travelledLabel?: string;
  /** Legend wording for the muted no-data fill. Rendered whenever some
   * region on screen actually has no data — see `legendSwatches`. */
  noDataLabel?: string;
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
   * `.fitSize(...)` already called). Defaults to geoMercator, which is
   * conformal and so keeps every region's shape correct at any zoom — see
   * this module's own comment above for why that beats an equal-area
   * default on a map you expand into, and specifically why an azimuthal
   * projection is the wrong answer here (it needs explicit
   * `.rotate()`/`.center()` onto the data that fitSize alone doesn't
   * provide). */
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
  /** The subdivisions to draw in place of a clicked region, or null to
   * fall back to zoom-to-bounds for it (#107) — which is the right answer
   * for a region with no subdivision geometry (most countries) and for a
   * subdivision that's already the bottom of the chain.
   *
   * Only ever called for a feature from `features` — a subdivision drawn
   * by a previous expansion can't itself expand, since these are drawn
   * through one shared projection and nesting them further would need a
   * second, deeper geometry source this app doesn't have.
   *
   * May return a promise: county geometry is several times the size of
   * everything else a chart page loads, and making it awaitable is what
   * lets a caller `import()` it on the first expansion instead of
   * bundling it into the initial page. While one is pending, clicks are
   * ignored and the row above the map says so. */
  resolveExpansion?: (feature: GeoFeature) => GeoExpansion | null | Promise<GeoExpansion | null>;
  /** What the projection is fitted to, if not `features` themselves.
   *
   * For when one outlying feature would otherwise dictate the framing of
   * the whole map. The case this exists for: under Mercator, Antarctica
   * stretches across the bottom of the world and `fitSize` dutifully
   * shrinks every inhabited continent into the upper half of the frame to
   * make room for it. Fitting to the world *without* Antarctica frames
   * the part anyone is looking at, and Antarctica still gets drawn — it
   * simply runs off the bottom edge, which the outermost `<svg>` clips
   * for free. That's the same thing every web map does with it.
   *
   * Only affects framing. Everything in `features` is still drawn,
   * hoverable and clickable. */
  fitTo?: GeoFitTarget;
};

/** Discriminated union so one hover state serves both layers — a marker
 * sits on top of a region and should win the tooltip while hovered, not
 * show two overlapping readouts.
 *
 * The region case holds a whole `DrawnFeature`, not just a feature: with
 * states and counties on screen at once, the hovered polygon's own
 * accessors are the only way to read it correctly, and they travel with
 * it. */
type Hovered =
  | { kind: "region"; drawn: DrawnFeature; clientPos: { x: number; y: number } }
  | { kind: "marker"; marker: GeoMarker; clientPos: { x: number; y: number } };

export function InteractiveGeo<P extends GeoJsonProperties = GeoJsonProperties>({
  features,
  width,
  height,
  getValue,
  isTravelled,
  travelledLabel = "travelled through",
  noDataLabel = "no data",
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
  resolveExpansion,
  fitTo,
}: InteractiveGeoProps<P>) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  // The one region currently shown as its own subdivisions, together with
  // the key of the base feature it replaced — or null when the map is
  // whole.
  //
  // Exactly one at a time, deliberately. An earlier version accumulated
  // them (open Georgia, then open Alabama beside it, both staying open),
  // which sounds strictly more capable and reads as clutter: two
  // neighbouring states dissolved into a single undifferentiated field of
  // 226 counties, with no visual cue about which belonged to which. One
  // at a time keeps a clear figure/ground — the region you're inspecting
  // is subdivided, everything else stays whole as context — and clicking
  // a neighbour simply moves that focus, restoring the previous region's
  // own polygon on the way.
  const [expansion, setExpansion] = useState<{ key: string; value: GeoExpansion } | null>(null);
  // Only ever true while an async resolveExpansion is in flight. Kept out
  // of useD3's deps on purpose: it drives one line of text, and putting it
  // in deps would tear down and rebuild the entire SVG twice per
  // expansion for a caption change.
  const [expanding, setExpanding] = useState(false);
  // A state-backed callback ref, not a plain useRef — see interactive-
  // hist's own comment on why this needs to be state, not a ref read
  // during render.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  /** Identity of a base feature, for tracking what's expanded. Prefers
   * the GeoJSON `id` both us-atlas and world-atlas set on every feature;
   * falls back to the label so a caller's own geometry without ids still
   * works. */
  const featureKey = useCallback((f: GeoFeature) => String(f.id ?? getLabel(f as Feature<Geometry, P>)), [getLabel]);

  // Every polygon to draw, base and expanded together, each carrying the
  // accessors that read it. An expanded region contributes its
  // subdivisions *instead of* itself, which is the whole in-place trick:
  // same list, same projection, one polygon swapped for many.
  const drawn = useMemo<DrawnFeature[]>(() => {
    const entries: DrawnFeature[] = [];
    for (const f of features.features) {
      const key = featureKey(f);
      if (expansion?.key === key) continue; // replaced by its subdivisions below
      entries.push({
        feature: f,
        getValue: getValue as DrawnFeature["getValue"],
        getLabel: getLabel as DrawnFeature["getLabel"],
        isTravelled: isTravelled as DrawnFeature["isTravelled"],
        valueLabel,
        expandableKey: key,
      });
    }
    for (const f of expansion?.value.features.features ?? []) {
      entries.push({
        feature: f,
        getValue: expansion!.value.getValue,
        getLabel: expansion!.value.getLabel,
        // No fallback to the map's own `isTravelled`: an expansion's
        // subdivisions are a different geography answered by different
        // data, so a map-level accessor asked about a county it has
        // never heard of would answer for the wrong feature. An
        // expansion that wants the tint says so itself.
        isTravelled: expansion!.value.isTravelled,
        valueLabel: expansion!.value.valueLabel ?? valueLabel,
        // A subdivision is the bottom of the chain — see
        // resolveExpansion's own prop comment.
        expandableKey: null,
      });
    }
    return entries;
  }, [features, expansion, featureKey, getValue, getLabel, isTravelled, valueLabel]);

  // Computed here (not inside useD3 below) so the legend can read the same
  // domain/scale without duplicating the computation — same split
  // InteractiveCalendar uses. colorScale is itself stable across renders
  // that don't change domain/colorMode (useMemo), which matters: it's one
  // of useD3's deps, and an unstable reference there is exactly the #23
  // rebuild-on-every-pointermove bug this file's own module comment warns
  // about.
  //
  // Spans everything on screen, states and counties alike, because they
  // *are* on screen together and one legend has to explain all of it.
  // That's honest here in a way it wouldn't be for every chart: both
  // levels measure the same thing in the same unit (days present in an
  // area), so a county reading darker than the state next to it is a true
  // comparison, not an artifact of two scales sharing a color ramp.
  const domain = useMemo<[number, number]>(() => {
    const values = drawn.map((d) => d.getValue(d.feature)).filter((v): v is number => v != null && v > 0);
    return values.length ? [Math.min(...values), Math.max(...values)] : [1, 10];
  }, [drawn]);
  const colorScale = useMemo(() => sequentialLogScale(domain, colorMode), [domain, colorMode]);
  const travelledColor = travelledFill(colorMode);

  /** The three-state fill, in one place because the D3 paint and the
   * tooltip's own swatch have to agree — they read the same polygon and
   * a second copy of this precedence would be a silent way for the
   * tooltip to describe a colour the map isn't showing.
   *
   * Precedence is value -> travelled -> no data. See `isTravelled`'s prop
   * comment for why a real value wins. */
  const resolveFill = useCallback(
    (d: DrawnFeature): { color: string; state: "value" | "travelled" | "none"; value: number | null } => {
      const v = d.getValue(d.feature);
      if (v != null && v > 0) return { color: colorScale(v), state: "value", value: v };
      if (d.isTravelled?.(d.feature)) return { color: travelledColor, state: "travelled", value: null };
      return { color: "var(--muted)", state: "none", value: null };
    },
    [colorScale, travelledColor],
  );

  /** The off-ramp fills to name in the legend — only the ones actually
   * on screen.
   *
   * Naming a state nothing is currently in would be worse than naming
   * none: a "travelled through" key beside a map with no travelled
   * region reads as "and none of these are travelled", which is a claim
   * about the data rather than a key to it. So this scans what's drawn
   * rather than keying off whether an `isTravelled` prop was passed.
   *
   * "no data" appears here for every geo chart, not just travelled ones.
   * That fill has existed since #24 and has never been named anywhere
   * but a tooltip, so a region you never happened to hover was simply
   * unexplained — a pre-existing gap this issue's legend slot closes on
   * the way past, rather than one it introduces.
   *
   * O(drawn), same as `domain` above and memoized alongside it. */
  const legendSwatches = useMemo(() => {
    let travelled = false;
    let none = false;
    for (const d of drawn) {
      const { state } = resolveFill(d);
      if (state === "travelled") travelled = true;
      else if (state === "none") none = true;
      if (travelled && none) break;
    }
    const out: { label: string; color: string }[] = [];
    if (travelled) out.push({ label: travelledLabel, color: travelledColor });
    if (none) out.push({ label: noDataLabel, color: "var(--muted)" });
    return out;
  }, [drawn, resolveFill, travelledLabel, travelledColor, noDataLabel]);

  const mapHeight = Math.max(0, height - LEGEND_AREA_HEIGHT - (legendSwatches.length ? LEGEND_SWATCH_ROW_HEIGHT : 0));
  const resolvedMarkerColor = markerColor ?? categoricalColor(0);

  /** Show one region as its own subdivisions, restoring whichever region
   * was previously open back to its single polygon. */
  const expand = useCallback((key: string, value: GeoExpansion) => {
    // Hover is cleared in the same setState batch: the tooltip is showing
    // a polygon that's about to stop existing, and leaving it up for a
    // frame reads as a stale readout attached to the new drawing.
    setHovered(null);
    setExpansion({ key, value });
  }, []);

  // The view change the *next* draw owes, when a click both changes what's
  // expanded and wants to move the camera.
  //
  // This indirection is load-bearing rather than fussy. Expanding or
  // collapsing is React state, so it rebuilds the SVG — and a d3
  // transition started in the click handler dies with the nodes it was
  // animating. That's what made "click the background" take two clicks to
  // get home: the first click collapsed and started a zoom-out, the
  // rebuild cancelled the zoom-out mid-flight and re-applied the
  // still-zoomed transform, and only a second click (which changed no
  // state, so rebuilt nothing) actually animated. Deferring the camera
  // move to just after the rebuild makes it one click, still animated.
  //
  // A ref, not state: it's a one-shot instruction consumed by the very
  // next draw, and making it state would trigger another rebuild purely
  // to clear it.
  type PendingView =
    | { kind: "reset" }
    | { kind: "expansion"; key: string }
    | { kind: "feature"; key: string };
  const pendingViewRef = useRef<PendingView | null>(null);
  // The base `features` reference as of the last draw, to tell "the whole
  // map changed" apart from "only the expansions changed" — see where the
  // zoom transform is carried, in the render function below.
  const lastBaseFeaturesRef = useRef(features);

  /** Put one expanded region back to its own single polygon. */
  const collapse = useCallback(() => {
    setHovered(null);
    setExpansion(null);
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
      if (drawn.length === 0) return;

      // Fitted to the *base* features only, never to what's currently
      // drawn. This is the single line that makes expansion happen in
      // place: refitting to include an expansion's subdivisions would
      // rescale and re-centre the whole map on every expand and collapse,
      // sliding every other region out from under the pointer. The base
      // map's framing is fixed; expanding only ever changes what fills
      // one outline.
      const fittedProjection = projection().fitSize([width, mapHeight], fitTo ?? features);
      const path = d3.geoPath(fittedProjection);

      // d3-zoom keeps the current transform on the DOM node itself (the
      // `__zoom` expando), and useD3 only clears the <svg>'s *children* —
      // the element itself survives every rebuild. So the transform has to
      // be handled explicitly on every rebuild, in one of two ways:
      //
      //  - The base map changed (a different `features` prop entirely,
      //    e.g. switching city on the city heatmap): reset to identity.
      //    Carrying one map's zoom onto another's geometry is meaningless.
      //  - Only the expansions changed: *keep* the transform and re-apply
      //    it to the newly-created <g> below. Expanding a region must not
      //    throw away the zoom the reader is already at.
      //
      // Getting this wrong was a real, latent bug before in-place
      // expansion existed: the fresh <g> had no transform attribute while
      // `__zoom` still held the old one, so the map *looked* unzoomed and
      // the next scroll snapped the view.
      const baseChanged = lastBaseFeaturesRef.current !== features;
      lastBaseFeaturesRef.current = features;
      const node = svg.node();
      const carriedTransform = baseChanged || !node ? d3.zoomIdentity : d3.zoomTransform(node);
      svg.property("__zoom", carriedTransform);

      const g = svg
        .attr("width", width)
        .attr("height", mapHeight)
        .append("g")
        .attr("transform", carriedTransform.toString());

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
        .selectAll<SVGPathElement, DrawnFeature>("path.geo-region")
        .data(drawn)
        .join("path")
        .attr("class", "geo-region")
        .attr("d", (d) => path(d.feature))
        .attr("fill", (d) => resolveFill(d).color)
        .attr("stroke", "var(--border)")
        .attr("stroke-width", 0.5)
        // Borders stay 0.5 *screen* pixels at every zoom level instead of
        // being scaled up with the geometry. Zooming in therefore makes
        // them sharper and finer rather than fatter — at 8x a scaled
        // stroke would render 4px wide and start swallowing small
        // counties whole.
        //
        // `vector-effect`, not a counter-scale in the zoom handler the way
        // markers below do it: markers are a handful of circles, but a
        // drilled-into map can carry thousands of paths, and rewriting a
        // stroke-width attribute across all of them on every zoom tick is
        // exactly the kind of per-frame DOM churn that makes a pan feel
        // heavy. The browser applies this one at paint time, for free.
        .attr("vector-effect", "non-scaling-stroke");

      // The outline of the expanded region, drawn unfilled on top of its
      // own subdivisions. Without it a state dissolves into a field of
      // counties the moment it opens, and the boundary the reader clicked
      // — the one thing orienting them — disappears. `pointer-events:
      // none` so it's purely cartographic and never eats a click meant
      // for a county underneath.
      g.selectAll<SVGPathElement, GeoExpansion>("path.geo-expanded-outline")
        .data(expansion ? [expansion.value] : [])
        .join("path")
        .attr("class", "geo-expanded-outline")
        .attr("d", (e) => path(e.features))
        .attr("fill", "none")
        .attr("stroke", "var(--foreground)")
        .attr("stroke-opacity", 0.45)
        .attr("stroke-width", 1)
        .attr("vector-effect", "non-scaling-stroke")
        .style("pointer-events", "none");

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

      /** Zoom to any GeoJSON object's bounds — a single feature, or a
       * whole FeatureCollection (which is what an expanded region's
       * extent is, once its own polygon is gone). */
      function zoomToBounds(target: Parameters<typeof path.bounds>[0]) {
        const [[x0, y0], [x1, y1]] = path.bounds(target);
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

      /** Zoom to a base feature, closing whatever was open on the way.
       * Deferred through pendingViewRef when there's actually something
       * to close, since that rebuild would otherwise kill the
       * transition — see that ref's own comment. */
      function leaveExpansionAndZoomTo(key: string, feature: GeoFeature) {
        if (expansion) {
          pendingViewRef.current = { kind: "feature", key };
          collapse();
        } else {
          zoomToBounds(feature);
        }
      }

      regions.style("cursor", "pointer").on("click", function (event, d) {
        // Stops this from also reaching the background click handler
        // below (a click that lands on a region isn't also "outside every
        // region").
        event.stopPropagation();
        // A subdivision of the region that's currently open. Clicking one
        // is staying *inside* what you drilled into, not leaving it, so
        // this zooms without collapsing — otherwise clicking a county
        // would snap its whole state back to a single polygon, which
        // reads as the map undoing your work.
        if (d.expandableKey === null) {
          zoomToBounds(d.feature);
          return;
        }
        const key = d.expandableKey;
        if (!resolveExpansion) {
          zoomToBounds(d.feature);
          return;
        }
        const next = resolveExpansion(d.feature);
        if (next === null) {
          // Nothing to expand into (a country with no subdivision
          // geometry). Still counts as clicking away from whatever was
          // open, so it closes that too rather than leaving a region
          // subdivided off in the corner while the camera flies
          // somewhere unrelated.
          leaveExpansionAndZoomTo(key, d.feature);
          return;
        }
        if (!(next instanceof Promise)) {
          pendingViewRef.current = { kind: "expansion", key };
          expand(key, next);
          return;
        }
        setExpanding(true);
        next
          .then((resolved) => {
            if (resolved) {
              pendingViewRef.current = { kind: "expansion", key };
              expand(key, resolved);
            } else {
              leaveExpansionAndZoomTo(key, d.feature);
            }
          })
          // A failed geometry import shouldn't leave the map stuck
          // showing "Loading…" forever with clicks swallowed; fall back
          // to the zoom the click would have done without an expansion
          // configured at all.
          .catch(() => leaveExpansionAndZoomTo(key, d.feature))
          .finally(() => setExpanding(false));
      });

      // Clicking the background resets to the origin view. A click that
      // landed on a region stopPropagation()s above before it bubbles
      // here; a real pan gesture's click gets suppressed by d3-zoom
      // itself before it's even dispatched (d3-zoom only suppresses the
      // native click after a gesture that actually moved — see
      // interactive-network.tsx's own comment on the equivalent d3-drag
      // behavior), so this only ever fires for a true click on open
      // background.
      // Clicking open background is a single "reset the map" gesture: it
      // closes whatever region is open *and* animates back to the origin
      // view, in one click. A click that landed on a region
      // stopPropagation()s above before it bubbles here; a real pan
      // gesture's click gets suppressed by d3-zoom itself before it's
      // even dispatched (d3-zoom only suppresses the native click after a
      // gesture that actually moved — see interactive-network.tsx's own
      // comment on the equivalent d3-drag behavior), so this only ever
      // fires for a true click on open background.
      svg.on("click", () => {
        if (expansion) {
          // Collapsing rebuilds the SVG, so the zoom-out is handed to the
          // next draw instead of started here where it would be killed
          // half-finished. It still animates, from wherever the reader
          // currently is — the transform is carried across the rebuild.
          pendingViewRef.current = { kind: "reset" };
          collapse();
        } else {
          svg.transition().duration(600).call(zoomBehavior.transform, d3.zoomIdentity);
        }
      });

      svg.call(zoomBehavior);

      // The camera move owed by the click that caused this draw — see
      // pendingViewRef above for why it can't happen in the handler.
      const pendingView = pendingViewRef.current;
      pendingViewRef.current = null;
      if (pendingView?.kind === "reset") {
        svg.transition().duration(600).call(zoomBehavior.transform, d3.zoomIdentity);
      } else if (pendingView?.kind === "expansion") {
        // Targets the expansion's own features, not the region that was
        // clicked — that region's polygon no longer exists to measure.
        // Only if the open region is still the one that asked for it: a
        // second click landing before this draw supersedes the first.
        if (expansion?.key === pendingView.key) zoomToBounds(expansion.value.features);
      } else if (pendingView?.kind === "feature") {
        const target = drawn.find((entry) => entry.expandableKey === pendingView.key);
        if (target) zoomToBounds(target.feature);
      }

      attachMarkHover<DrawnFeature>(
        regions as unknown as d3.Selection<d3.BaseType, DrawnFeature, d3.BaseType, unknown>,
        {
          onHover: (drawnFeature, clientPos) => setHovered({ kind: "region", drawn: drawnFeature, clientPos }),
          onLeave: () => setHovered(null),
        },
      );

      // Marker overlay (#264) — projected straight from each marker's own
      // [lng, lat] via the same fitted projection the regions use, so it
      // lands correctly regardless of which projection a caller passed.
      // Appended into the same zoom-transformed `g`, after the region
      // paths, so markers draw on top and pan/zoom in lockstep.
      //
      // Unaffected by expansion, and that's a real dividend of doing this
      // in place rather than as a level swap: the projection never
      // changes, so every marker stays exactly where it belongs no matter
      // which regions are open. (A level swap would have had to hide them
      // — the old geometry they were positioned against would be gone.)
      if (markers && markers.length > 0) {
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
          // Counter-scaled by the carried transform, not drawn at 1x:
          // this rebuild can happen while already zoomed in (expanding a
          // region keeps the reader's zoom), and markers sized for 1x
          // would appear bloated by exactly that factor until the next
          // zoom event corrected them.
          .attr("r", (d) => markerRadius(d) / carriedTransform.k)
          .attr("fill", resolvedMarkerColor)
          .attr("fill-opacity", 0.85)
          .attr("stroke", "var(--card)")
          .attr("stroke-width", MARK_SPECS.marker.ringWidth / carriedTransform.k);

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
      // `drawn` carries every polygon and its accessors, and changes
      // identity exactly when the drawing should. `features` and
      // `expansion` are here too, separately: the projection is fitted to
      // the base features alone, and the expanded-region outline is drawn
      // from the expansion directly.
      drawn,
      features,
      fitTo,
      expansion,
      width,
      mapHeight,
      // resolveFill, not colorScale: the paint reads the three-state
      // resolver now, and it already closes over the scale.
      resolveFill,
      zoomExtent,
      projection,
      resolveExpansion,
      expand,
      collapse,
      markers,
      getMarkerValue,
      markerRadiusScale,
      scaleMarkersByValue,
      resolvedMarkerColor,
    ],
  );

  const containerRect = containerEl?.getBoundingClientRect();
  // Read through resolveFill so the tooltip's swatch is literally the
  // colour on the map, including the travelled tint.
  const hoveredFill = hovered?.kind === "region" ? resolveFill(hovered.drawn) : null;
  const hoveredValue = hoveredFill?.value ?? null;
  const hoveredColor = hoveredFill?.state === "value" ? hoveredFill.color : undefined;
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
      {/* No label for what's open, and no close button. With one region
          expanded at a time, its own outline says which one, and clicking
          anywhere else — another region, or open background — leaves it.
          A chip naming it was a row of chrome restating what the map
          already shows, and it cost the map 28px of height. */}
      <div
        ref={setContainerEl}
        style={{ position: "relative", width, height: mapHeight }}
        role="img"
        aria-label={ariaLabel}
      >
        <svg ref={ref} />
        {expanding ? (
          // Absolutely positioned, so it costs the map no layout height —
          // a row that appeared on first click would shrink the SVG,
          // refit the projection and shift every polygon on screen.
          // role=status so the wait is announced, not only shown: loading
          // a county file is the one interaction here that isn't instant.
          <span
            role="status"
            className="pointer-events-none absolute top-2 left-2 rounded-full bg-card/90 px-2 py-0.5 text-xs text-muted-foreground shadow-sm"
          >
            Loading…
          </span>
        ) : null}
        {hovered && containerRect ? (
          <ChartTooltip
            x={hovered.clientPos.x - containerRect.left}
            y={hovered.clientPos.y - containerRect.top}
            title={hovered.kind === "region" ? hovered.drawn.getLabel(hovered.drawn.feature) : hovered.marker.label}
            rows={
              hovered.kind === "region"
                ? hoveredFill?.state === "value" && hoveredValue != null
                  ? [
                      {
                        label: hovered.drawn.valueLabel ?? valueLabel,
                        value: formatValue(hoveredValue),
                        color: hoveredColor ?? "",
                        variant: "swatch" as const,
                      },
                    ]
                  : // A travelled region says so instead of reading "no
                    // data", which is the opposite of true for it — the
                    // whole point is that something is known about it.
                    // Its swatch is the tint itself, so the row matches
                    // the polygon under the pointer.
                    [
                      hoveredFill?.state === "travelled"
                        ? { label: travelledLabel, value: "", color: hoveredFill.color, variant: "swatch" as const }
                        : { label: noDataLabel, value: "", color: "var(--muted-foreground)", variant: "swatch" as const },
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
      <SequentialLegend
        domain={domain}
        colorScale={colorScale}
        formatValue={formatValue}
        valueT={legendT}
        swatches={legendSwatches}
        className="pt-2"
      />
    </div>
  );
}
