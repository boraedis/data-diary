"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { useD3 } from "@/hooks/use-d3";
import { ChartTooltip, type TooltipRow } from "./tooltip";
import { categoricalColor, contrastingTextColor } from "@/lib/viz/color";

// InteractiveNetwork — the shared force-directed graph primitive, rebuilt
// as a *live* simulation.
//
// The first version (#23) ran the force layout to convergence once,
// synchronously, and drew the result as a still image: dragging a node
// moved only that node, nothing reacted, and every filter change re-laid
// the whole graph out from scratch. It read as broken next to legacy's
// people_network, whose appeal was exactly that the graph was *alive* —
// grab someone and their friends follow, let go and everything settles
// back. This version keeps the simulation running (it cools and stops on
// its own; a drag reheats it), which is legacy's model.
//
// It still fits useD3's rebuild-on-deps-change pattern rather than an
// enter/update/exit join: node positions (and velocities) are carried
// across rebuilds in a ref, so when the caller's nodes/edges change — a
// period slider moved, a tag hidden — the new SVG starts every surviving
// node exactly where the old one left it and the simulation slides them
// into the new layout, instead of a cold re-layout that jumbles the graph.
// Brand-new nodes start next to a neighbour that's already placed.
//
// Hover, selection, and zoom never rebuild: they're applied by mutating
// the existing DOM (see useD3's own doc comment on why anything that
// changes per pointer event must stay out of deps). Selection is
// controlled by the caller (`selectedId`/`onSelect`) so a details panel
// or search box outside the SVG can drive it; the effect that reacts to it
// calls into the live render through `apiRef` instead of re-rendering.
//
// Focus (dimming everything but a node and its neighbours) is click-only
// (#435 feedback). It used to follow hover too, which meant sweeping the
// pointer across a dense graph strobed the whole thing, and grabbing a
// node to drag it re-dimmed the graph around it. Hover now only shows the
// tooltip and a ring; a drag never selects (d3-drag swallows the click
// that ends a real drag); clicking anything else — another node, or the
// background — moves or clears the focus.

/** Module-level so they're referentially stable as useD3 deps (a default
 * parameter written as an array literal is a fresh array every render,
 * which would rebuild the SVG on every hover-driven re-render). */
const DEFAULT_RADIUS_RANGE: [number, number] = [3, 18];
const DEFAULT_ZOOM_EXTENT: [number, number] = [0.2, 6];

/** A node's label shows when its on-screen radius is at least this many
 * px — so at the default zoom only the most-logged people are labelled,
 * and zooming in reveals the rest instead of the whole graph drowning in
 * overlapping names. Focused/hovered nodes and their neighbours are always
 * labelled regardless. */
const LABEL_MIN_SCREEN_RADIUS = 6;
/** The largest nodes are labelled at any zoom, so a zoomed-out overview
 * of a big graph still names its landmarks. */
const ALWAYS_LABELLED = 12;
/** Label size in screen px, held constant under zoom by counter-scaling. */
const LABEL_FONT_PX = 11;
/** Ticks run synchronously before the first paint of a graph with no
 * remembered positions — enough to untangle d3's initial phyllotaxis
 * spiral into a recognisable layout, so the reader never watches a
 * starburst explode outward; the rest of the settling happens live. */
const PREWARM_TICKS = 120;
const FIT_PADDING = 32;
/** Zoom cap when framing a selected node's neighbourhood. Without it a
 * person with one or two close ties would fill the screen. */
const FOCUS_MAX_SCALE = 2.5;
const FOCUS_DURATION_MS = 600;
/** Initials inside a node: the largest on-screen font that fits the
 * circle, capped, and hidden below the minimum — a 5px "JS" is noise. */
const INITIALS_MAX_FONT_PX = 15;
const INITIALS_MIN_FONT_PX = 7;

/**
 * "Harry Joe Schuster" → "HJS", the way legacy's network labelled its
 * nodes. A parenthetical is dropped first ("Austin (Rocks Villas)" is
 * Austin, not "A(V"), as is a trailing regnal numeral ("John Smith III" →
 * "JS"), and it's capped at three letters so a long name still fits a
 * circle.
 */
export function initials(label: string): string {
  const words = label
    .replace(/\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  if (words.length > 1 && /^(?:I{1,3}|IV|V|VI{0,3}|IX|X|Jr\.?|Sr\.?)$/.test(words[words.length - 1])) words.pop();
  return words
    .map((w) => [...w].find((ch) => /\p{L}/u.test(ch)) ?? "")
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export type NetworkNode = { id: string | number; label: string; count: number };
/** `weight` is a normalised tie strength, 0–1: it sets edge thickness and
 * opacity and how strongly the simulation pulls the two ends together.
 * Callers with a raw count should normalise it themselves — the primitive
 * doesn't guess a scale. */
export type NetworkEdge = { source: string | number; target: string | number; weight: number };

type NodeId = NetworkNode["id"];
type SimNode = NetworkNode & d3.SimulationNodeDatum & { r: number; degree: number };
type SimLink = d3.SimulationLinkDatum<SimNode> & { weight: number };
type SavedPosition = { x: number; y: number; vx: number; vy: number };

type LiveApi = {
  setSelected: (id: NodeId | null, opts: { reveal: boolean }) => void;
};

type Hovered = { node: NetworkNode; clientPos: { x: number; y: number } };

export type InteractiveNetworkProps = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  width: number;
  height: number;
  /** Node fill: one colour, or a function of the node. Must be
   * referentially stable (module-level or useCallback) — it's a rebuild
   * dependency. */
  color?: string | ((node: NetworkNode) => string);
  /** `d3.scaleSqrt` range, px — node radius by count. */
  radiusRange?: [number, number];
  /** Count that maps to the top of `radiusRange`. Defaults to the largest
   * count among `nodes`; pass it when the caller hides nodes without
   * changing anyone's count (a legend toggle), so the survivors don't all
   * grow to fill the scale the hidden ones used to top out. */
  radiusDomainMax?: number;
  zoomExtent?: [number, number];
  /** Controlled selection: the selected node stays highlighted with its
   * neighbours until cleared. Omit both for hover-only highlighting. */
  selectedId?: NodeId | null;
  onSelect?: (id: NodeId | null) => void;
  /** Called when a node drag begins moving (not on a plain press, so a
   * click still just selects). A caller that rebuilds the graph on a
   * timer (the people network's time-lapse) uses it to pause — a rebuild
   * mid-drag replaces the SVG, and with it the node being held. Read
   * through a ref, so it needn't be stable. */
  onNodeDragStart?: () => void;
  /** Width, px, of the chart's left edge a caller covers with its own
   * overlay while something is selected (the people network's details
   * panel) — the zoom-to-selection frames the neighbourhood in the space
   * to its right instead of underneath it. */
  focusInsetLeft?: number;
  /** Tooltip content for a hovered node. Defaults to label + count. */
  tooltip?: (node: NetworkNode) => { title: string; rows: TooltipRow[] };
  ariaLabel?: string;
};

function nodeId(v: SimLink["source"]): NodeId {
  // forceLink swaps the raw ids for node objects when it initialises.
  return typeof v === "object" ? (v as SimNode).id : v;
}

export function InteractiveNetwork({
  nodes,
  edges,
  width,
  height,
  color = categoricalColor(0),
  radiusRange = DEFAULT_RADIUS_RANGE,
  radiusDomainMax,
  zoomExtent = DEFAULT_ZOOM_EXTENT,
  selectedId = null,
  onSelect,
  onNodeDragStart,
  focusInsetLeft = 0,
  tooltip,
  ariaLabel = "Force-directed network graph. Scroll or pinch to zoom, drag the background to pan, drag a node to pull it around, click a node to highlight its connections, click the background to clear or re-fit.",
}: InteractiveNetworkProps) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  // State-backed callback ref, not useRef — the tooltip needs the
  // container's rect during render (see interactive-hist's comment).
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  // Survive rebuilds: where every node was, the viewer's zoom/pan, and
  // the latest selection/select callback (read from inside D3 handlers
  // that were bound during an earlier render).
  const positionsRef = useRef(new Map<NodeId, SavedPosition>());
  // The camera is only meaningful for the size it was set at — see the
  // initial-transform comment below.
  const transformRef = useRef<{ transform: d3.ZoomTransform; width: number; height: number } | null>(null);
  const selectedRef = useRef<NodeId | null>(selectedId);
  const onSelectRef = useRef(onSelect);
  const onDragStartRef = useRef(onNodeDragStart);
  const focusInsetRef = useRef(focusInsetLeft);
  const apiRef = useRef<LiveApi | null>(null);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onDragStartRef.current = onNodeDragStart;
    focusInsetRef.current = focusInsetLeft;
  }, [onSelect, onNodeDragStart, focusInsetLeft]);

  const resolveColor = (n: NetworkNode) => (typeof color === "function" ? color(n) : color);

  const ref = useD3<SVGSVGElement>(
    (svg) => {
      apiRef.current = null;
      if (nodes.length === 0) return;

      const radius = d3
        .scaleSqrt()
        .domain([0, radiusDomainMax ?? d3.max(nodes, (n) => n.count) ?? 1])
        .range(radiusRange);

      const nodeIds = new Set(nodes.map((n) => n.id));
      const landmarks = new Set(
        [...nodes]
          .sort((x, y) => y.count - x.count)
          .slice(0, ALWAYS_LABELLED)
          .map((n) => n.id),
      );
      const links: SimLink[] = edges
        .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
        .map((e) => ({ source: e.source, target: e.target, weight: e.weight }));

      const neighbours = new Map<NodeId, Set<NodeId>>(nodes.map((n) => [n.id, new Set()]));
      for (const l of links) {
        neighbours.get(l.source as NodeId)!.add(l.target as NodeId);
        neighbours.get(l.target as NodeId)!.add(l.source as NodeId);
      }

      // --- Seed positions ------------------------------------------------
      const saved = positionsRef.current;
      const hadPositions = nodes.some((n) => saved.has(n.id));
      const simNodes: SimNode[] = nodes.map((n) => {
        const node: SimNode = { ...n, r: radius(n.count), degree: neighbours.get(n.id)!.size };
        const pos = saved.get(n.id);
        if (pos) Object.assign(node, pos);
        return node;
      });
      if (hadPositions) {
        // A node joining an existing layout starts beside a placed
        // neighbour (so it grows out of its cluster rather than flying in
        // from the origin), or on the rim if it has none.
        const placed = new Map(simNodes.filter((n) => saved.has(n.id)).map((n) => [n.id, n]));
        for (const n of simNodes) {
          if (saved.has(n.id)) continue;
          const anchor = [...neighbours.get(n.id)!].map((id) => placed.get(id)).find(Boolean);
          const angle = Math.random() * 2 * Math.PI;
          const dist = anchor ? 20 : 200;
          n.x = (anchor?.x ?? 0) + Math.cos(angle) * dist;
          n.y = (anchor?.y ?? 0) + Math.sin(angle) * dist;
        }
      }

      // --- Forces --------------------------------------------------------
      // Coordinates are centred on (0, 0); the zoom transform puts that in
      // the middle of the viewport. forceX/forceY (legacy's choice) rather
      // than forceCenter: forceCenter only recentres the *mean*, so small
      // disconnected clusters and isolated people drift off-screen, while
      // a weak per-node pull keeps every island in view. Isolated nodes get
      // a firmer pull — nothing else is holding them. The horizontal pull
      // is scaled down by the viewport's aspect ratio so the graph spreads
      // into a wide card as an ellipse rather than a circle that only ever
      // uses the middle third of it.
      const aspect = Math.max(1, width / Math.max(1, height));
      const simulation = d3
        .forceSimulation<SimNode>(simNodes)
        .force(
          "link",
          d3
            .forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            // Strong ties sit close, weak ones long — the layout itself
            // reads as "who's actually together".
            .distance((l) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              return s.r + t.r + 18 + 70 * (1 - l.weight);
            })
            // d3's default (1 / smaller degree) stops hubs being yanked
            // around by dozens of springs; scaled by weight so a strong tie
            // pulls harder than a weak one. Scaled *up* from the default
            // for most ties, not down: a softer version of this made a
            // dragged person slide away from their friends alone, which is
            // exactly the "nothing reacts" feel this rebuild is replacing.
            .strength((l) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              return Math.min(1, (0.6 + 1.2 * l.weight) / Math.max(1, Math.min(s.degree, t.degree)));
            }),
        )
        .force(
          "charge",
          d3
            .forceManyBody<SimNode>()
            .strength((d) => -25 - d.r * 3)
            .distanceMax(420),
        )
        .force("x", d3.forceX<SimNode>(0).strength((d) => (d.degree === 0 ? 0.1 : 0.04) / aspect))
        .force("y", d3.forceY<SimNode>(0).strength((d) => (d.degree === 0 ? 0.1 : 0.04)))
        .force(
          "collide",
          d3.forceCollide<SimNode>().radius((d) => d.r + 2),
        )
        .stop();

      const reduceMotion =
        typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!hadPositions) {
        // Reduced motion: settle completely up front instead of animating.
        // Dragging still moves things — that's motion the reader asked for.
        const ticks = reduceMotion ? 300 : PREWARM_TICKS;
        for (let i = 0; i < ticks; i++) simulation.tick();
      }

      // --- DOM ----------------------------------------------------------
      svg.attr("width", width).attr("height", height).style("display", "block").style("touch-action", "none");
      const viewport = svg.append("g");

      const link = viewport
        .append("g")
        .attr("stroke", "var(--foreground)")
        .attr("stroke-linecap", "round")
        .selectAll<SVGLineElement, SimLink>("line")
        .data(links)
        .join("line")
        .attr("vector-effect", "non-scaling-stroke")
        .attr("stroke-width", (l) => 0.5 + 3 * l.weight);

      const node = viewport
        .append("g")
        .selectAll<SVGGElement, SimNode>("g")
        .data(simNodes, (d) => d.id)
        .join("g")
        .style("cursor", "grab");

      const circle = node
        .append("circle")
        .attr("r", (d) => d.r)
        .attr("fill", (d) => resolveColor(d))
        .attr("stroke", "var(--card)")
        .attr("stroke-width", 1)
        .attr("vector-effect", "non-scaling-stroke");

      // Initials sit inside the circle, coloured black or white against
      // that circle's own painted fill — read back with getComputedStyle,
      // since a fill can be a `var()` (the untagged grey) that d3 can't
      // parse. Sized per zoom level in applyZoomScale.
      const inner = node
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .style("pointer-events", "none")
        .style("user-select", "none")
        .style("font-weight", "600")
        .text((d) => initials(d.label));
      inner.attr("fill", function () {
        const shape = (this as SVGTextElement).previousElementSibling;
        return contrastingTextColor(shape ? getComputedStyle(shape).fill : "");
      });

      // Labels live in their own layer above every node rather than inside
      // each node's <g>: nodes later in paint order would otherwise cover
      // an earlier node's label wherever the graph is dense.
      const label = viewport
        .append("g")
        .style("pointer-events", "none")
        .selectAll<SVGTextElement, SimNode>("text")
        .data(simNodes, (d) => d.id)
        .join("text")
        .attr("dy", "0.35em")
        .attr("fill", "var(--foreground)")
        .attr("stroke", "var(--card)")
        .attr("stroke-linejoin", "round")
        .style("paint-order", "stroke")
        .style("pointer-events", "none")
        .style("user-select", "none")
        .text((d) => d.label);

      // Focus state, read by the tick loop's label pass as well as the
      // selection handlers below. `hoverId` only rings a node; it never
      // dims anything (see the header).
      let k = 1;
      let hoverId: NodeId | null = null;
      let focusId: NodeId | null = selectedRef.current;
      if (focusId !== null && !nodeIds.has(focusId)) focusId = null;
      let near: Set<NodeId> | null = null;
      let tickCount = 0;

      function ticked() {
        // Labels re-resolve every few ticks rather than every one: cheap
        // enough either way, but re-deciding each frame makes labels on
        // the edge of a collision flicker while the layout is moving.
        if (++tickCount % 6 === 0) updateLabels();
        link
          .attr("x1", (l) => (l.source as SimNode).x ?? 0)
          .attr("y1", (l) => (l.source as SimNode).y ?? 0)
          .attr("x2", (l) => (l.target as SimNode).x ?? 0)
          .attr("y2", (l) => (l.target as SimNode).y ?? 0);
        node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
        label.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      }
      ticked();

      // --- Labels -------------------------------------------------------
      // Which labels are eligible (landmarks, anything big enough on
      // screen, or — while something is focused — just it and its
      // neighbours), then a greedy collision pass in screen space: biggest
      // node first, and a label that would overlap one already placed is
      // skipped. Zooming in spreads nodes apart, so more labels fit. Widths
      // are estimated from character count rather than measured — close
      // enough for a collision test, and it keeps this off the DOM's
      // layout path inside the tick loop.
      function updateLabels() {
        const eligible = simNodes.filter((d) =>
          near !== null ? near.has(d.id) : landmarks.has(d.id) || d.r * k >= LABEL_MIN_SCREEN_RADIUS,
        );
        eligible.sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId) || b.r - a.r);
        const placed: [number, number, number, number][] = [];
        const shown = new Set<NodeId>();
        for (const d of eligible) {
          const x0 = ((d.x ?? 0) + d.r) * k + 4;
          const y0 = (d.y ?? 0) * k - LABEL_FONT_PX * 0.6;
          const x1 = x0 + d.label.length * LABEL_FONT_PX * 0.55;
          const y1 = y0 + LABEL_FONT_PX * 1.2;
          if (placed.some(([a, b, c, e]) => x0 < c && x1 > a && y0 < e && y1 > b)) continue;
          placed.push([x0, y0, x1, y1]);
          shown.add(d.id);
        }
        label.attr("display", (d) => (shown.has(d.id) ? null : "none"));
      }

      // --- Focus (selection) --------------------------------------------
      function applyStroke() {
        const selected = selectedRef.current;
        circle
          .attr("stroke", (d) => (d.id === selected || d.id === hoverId ? "var(--foreground)" : "var(--card)"))
          .attr("stroke-width", (d) => (d.id === selected ? 2.5 : d.id === hoverId ? 1.5 : 1));
      }

      function applyFocus() {
        near = focusId === null ? null : new Set([focusId, ...(neighbours.get(focusId) ?? [])]);
        const focusSet = near;
        const incident = (l: SimLink) => focusId !== null && (nodeId(l.source) === focusId || nodeId(l.target) === focusId);
        link
          .attr("stroke-opacity", (l) =>
            focusSet === null ? 0.1 + 0.4 * l.weight : incident(l) ? 0.35 + 0.6 * l.weight : 0.03,
          )
          .attr("stroke-width", (l) => (incident(l) ? 1 + 3.5 * l.weight : 0.5 + 3 * l.weight));
        node.attr("opacity", (d) => (focusSet === null || focusSet.has(d.id) ? 1 : 0.15));
        applyStroke();
        updateLabels();
        // The selected node and its neighbours float above the dimmed rest, so a
        // highlighted circle is never half-hidden under a faded stranger.
        if (focusSet !== null) node.filter((d) => focusSet.has(d.id)).raise();
      }

      function applyZoomScale() {
        label
          .attr("x", (d) => d.r + 4 / k)
          .attr("font-size", LABEL_FONT_PX / k)
          .attr("stroke-width", 3 / k);
        inner.each(function (d) {
          const text = this as SVGTextElement;
          const letters = Math.max(1, text.textContent?.length ?? 1);
          const screenRadius = d.r * k;
          // Width-bound (≈0.62em per capital, 80% of the diameter) or
          // height-bound (a cap height inside the radius), whichever bites.
          const px = Math.min(INITIALS_MAX_FONT_PX, (screenRadius * 1.6) / (letters * 0.62), screenRadius);
          if (px < INITIALS_MIN_FONT_PX) {
            text.setAttribute("display", "none");
          } else {
            text.removeAttribute("display");
            text.setAttribute("font-size", String(px / k));
          }
        });
      }

      // --- Zoom / pan ---------------------------------------------------
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent(zoomExtent)
        .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
          viewport.attr("transform", event.transform.toString());
          transformRef.current = { transform: event.transform, width, height };
          if (event.transform.k !== k) {
            k = event.transform.k;
            applyZoomScale();
            applyFocus();
          }
        });
      svg.call(zoom).on("dblclick.zoom", null);

      /** The transform that frames `subset` (every node, by default) in
       * the viewport, minus `insetLeft` px on the left, never zooming in
       * past `maxScale`. Labels hang off the right of a node, so the right
       * edge gets extra room when framing a small neighbourhood. */
      function fitTransform(subset: SimNode[] = simNodes, maxScale = 1.5, insetLeft = 0): d3.ZoomTransform {
        const labelRoom = subset === simNodes ? 0 : 90;
        const x0 = d3.min(subset, (d) => (d.x ?? 0) - d.r) ?? 0;
        const x1 = (d3.max(subset, (d) => (d.x ?? 0) + d.r) ?? 0) + labelRoom;
        const y0 = d3.min(subset, (d) => (d.y ?? 0) - d.r) ?? 0;
        const y1 = d3.max(subset, (d) => (d.y ?? 0) + d.r) ?? 0;
        const w = Math.max(1, x1 - x0);
        const h = Math.max(1, y1 - y0);
        const availableWidth = Math.max(1, width - insetLeft);
        const scale = Math.max(
          zoomExtent[0],
          Math.min(maxScale, (availableWidth - FIT_PADDING * 2) / w, (height - FIT_PADDING * 2) / h),
        );
        return d3.zoomIdentity
          .translate(insetLeft + availableWidth / 2, height / 2)
          .scale(scale)
          .translate(-(x0 + w / 2), -(y0 + h / 2));
      }

      // Keep the viewer's own zoom/pan across rebuilds (a filter change
      // shouldn't yank the camera); fit the first layout, and refit after a
      // resize, where the old translate would frame the graph off-centre.
      const kept = transformRef.current;
      svg.call(
        zoom.transform,
        kept && kept.width === width && kept.height === height ? kept.transform : fitTransform(),
      );
      applyZoomScale();
      applyFocus();

      // --- Drag ---------------------------------------------------------
      // Legacy's behaviour: grabbing a node reheats the simulation so its
      // neighbours follow; letting go releases it back into the layout.
      // The drag's container is the node's parent <g>, which sits inside
      // the zoomed viewport, so event.x/y are already in layout
      // coordinates at any zoom level.
      // d3-drag fires "start" on every press, clicks included; the first
      // "drag" event is the first real movement.
      let dragMoved = false;
      node.call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("start", function (event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
            d3.select(this).style("cursor", "grabbing");
            setHovered(null);
            dragMoved = false;
          })
          .on("drag", (event, d) => {
            if (!dragMoved) {
              dragMoved = true;
              onDragStartRef.current?.();
            }
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", function (event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
            d3.select(this).style("cursor", "grab");
          }),
      );

      // d3-drag swallows the click that ends a real drag, so this only
      // fires for a genuine press-and-release — dragging never selects.
      // Clicking the selected node again clears it; any other node takes
      // the focus over.
      node.on("click", (event: MouseEvent, d) => {
        event.stopPropagation();
        onSelectRef.current?.(selectedRef.current === d.id ? null : d.id);
      });
      // Likewise d3-zoom swallows the click that ends a pan. A background
      // click clears the focus if there is one, and otherwise refits the
      // view (what the old Fit button did). Deliberately two clicks, not
      // one doing both: clearing a selection while zoomed into a cluster
      // shouldn't also throw the camera back out to the whole graph.
      svg.on("click", () => {
        if (selectedRef.current !== null) {
          onSelectRef.current?.(null);
        } else {
          svg.transition().duration(500).call(zoom.transform, fitTransform());
        }
      });

      node
        .on("pointerenter", (event: PointerEvent, d) => {
          if (event.buttons !== 0) return; // mid-drag of something else
          hoverId = d.id;
          applyStroke();
          setHovered({ node: d, clientPos: { x: event.clientX, y: event.clientY } });
        })
        .on("pointermove", (event: PointerEvent, d) => {
          if (event.buttons !== 0) return;
          setHovered({ node: d, clientPos: { x: event.clientX, y: event.clientY } });
        })
        .on("pointerleave", () => {
          hoverId = null;
          applyStroke();
          setHovered(null);
        });

      // --- Run ----------------------------------------------------------
      simulation.on("tick", ticked).on("end", updateLabels);
      if (reduceMotion && !hadPositions) {
        simulation.alpha(0);
      } else {
        // A fresh graph keeps settling from wherever the prewarm cooled to
        // (reheating it would re-expand the layout the fit was just framed
        // around); a rebuilt one gets enough heat to slide into its new
        // shape.
        if (hadPositions) simulation.alpha(0.5);
        simulation.restart();
      }

      apiRef.current = {
        setSelected(id, { reveal }) {
          focusId = id !== null && nodeIds.has(id) ? id : null;
          applyFocus();
          if (!reveal || focusId === null) return;
          // Zoom to frame the selected node and its neighbours, wherever
          // the selection came from — a click in the graph, the search
          // box, or a name in the details panel. Clearing the selection
          // leaves the camera where it is; a background click with
          // nothing selected is what zooms back out to the whole graph.
          const focusSet = near!;
          const subset = simNodes.filter((n) => focusSet.has(n.id));
          svg
            .transition()
            .duration(FOCUS_DURATION_MS)
            .call(zoom.transform, fitTransform(subset, FOCUS_MAX_SCALE, focusInsetRef.current));
        },
      };

      return () => {
        simulation.stop();
        const next = new Map<NodeId, SavedPosition>();
        for (const n of simNodes) {
          next.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, vx: n.vx ?? 0, vy: n.vy ?? 0 });
        }
        // Merge rather than replace, so a node filtered out and later
        // restored comes back where it was.
        for (const [id, pos] of next) positionsRef.current.set(id, pos);
        svg.on(".zoom", null);
        svg.interrupt();
      };
    },
    [nodes, edges, width, height, color, radiusRange, radiusDomainMax, zoomExtent],
  );

  // Selection changes arrive as a prop; apply them to the live graph
  // without a rebuild.
  useEffect(() => {
    const changed = selectedRef.current !== selectedId;
    selectedRef.current = selectedId;
    if (changed) apiRef.current?.setSelected(selectedId, { reveal: true });
  }, [selectedId]);

  const containerRect = containerEl?.getBoundingClientRect();
  const tip = hovered ? (tooltip?.(hovered.node) ?? null) : null;

  return (
    <div ref={setContainerEl} style={{ position: "relative", width, height }}>
      <svg ref={ref} role="img" aria-label={ariaLabel} />
      {hovered && containerRect ? (
        <ChartTooltip
          x={hovered.clientPos.x - containerRect.left}
          y={hovered.clientPos.y - containerRect.top}
          title={tip?.title ?? hovered.node.label}
          rows={
            tip?.rows ?? [
              { label: "count", value: `${hovered.node.count}`, color: resolveColor(hovered.node) },
            ]
          }
          containerWidth={width}
        />
      ) : null}
    </div>
  );
}
