"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import {
  InteractiveNetwork,
  type NetworkEdge,
  type NetworkNode,
} from "@/components/charts/interactive/interactive-network";
import { GroupByPicker } from "@/components/charts/interactive/group-by-picker";
import { Legend, SeriesKey } from "@/components/charts/interactive/legend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseDate, toDateString } from "@/lib/date";
import {
  buildPeopleNetwork,
  MIN_MENTION_OPTIONS,
  monthlyFrameEnds,
  STRICTNESS_OPTIONS,
  type NetworkStrictness,
  type PeopleNetworkInput,
} from "@/lib/people-network";
import { formatDate, formatPercent } from "@/lib/viz/format";
import { NETWORK_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PEOPLE_NETWORK_METHODOLOGY } from "@/lib/viz/methodology";
import { PEOPLE_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// The people network, rebuilt from scratch: everyone with 10+ logged days
// (242 people over the full history, against the 100-person cap before),
// edges only where two people are logged together more often than chance
// would explain, and a live force layout you can grab and pull around.
// The statistics live in src/lib/people-network.ts (see its header for
// why raw shared-day counts were dropped); this component owns the page
// shell, the filter state, and the details panel, the same way
// life-timeline-chart.tsx does — the filters and the chart share state,
// and only plain data crosses the server/client boundary.

/** Untagged people: neutral rather than a categorical slot, so they read
 * as "no group" instead of a sixth group. */
const UNTAGGED_COLOR = "var(--muted-foreground)";
const UNTAGGED_KEY = "untagged";

const MIN_MENTION_PICKER = MIN_MENTION_OPTIONS.map((n) => ({ id: String(n), label: `${n}+` }));
const DEFAULT_MIN_MENTIONS = 10;

/** How many of a person's ties the details panel lists. */
const PANEL_CONNECTIONS = 10;

/** Time-lapse speeds, in monthly frames per second — the same three named
 * choices InteractiveBarRace offers, rather than a free slider. A frame
 * re-runs the significance test and rebuilds the SVG: a near-full frame
 * of the whole history measured 50–90ms in the (unminified) dev build,
 * inside even 2×'s 125ms. Default 1× plays the decade in about half a
 * minute. */
const SPEEDS = [
  { id: "slow", label: "0.5×", framesPerSecond: 2 },
  { id: "normal", label: "1×", framesPerSecond: 4 },
  { id: "fast", label: "2×", framesPerSecond: 8 },
] as const;
type SpeedId = (typeof SPEEDS)[number]["id"];

function tagKey(tagId: number | null): string {
  return tagId === null ? UNTAGGED_KEY : String(tagId);
}

export function PeopleNetworkChart({ data }: { data: PeopleNetworkInput }) {
  const [minMentions, setMinMentions] = useState<number>(DEFAULT_MIN_MENTIONS);
  const [strictness, setStrictness] = useState<NetworkStrictness>("significant");
  const [hiddenTags, setHiddenTags] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  // Time-lapse (#437). `frame` indexes `frames` below; null means "not in
  // the time-lapse", i.e. the whole selected period, which is also what
  // the last frame shows.
  const [frame, setFrame] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<SpeedId>("normal");

  const extent = useMemo<[Date, Date] | null>(() => {
    if (data.days.length === 0) return null;
    return [parseDate(data.days[0].date), parseDate(data.days[data.days.length - 1].date)];
  }, [data.days]);

  // The whole record — what's shown outside the time-lapse, and what the
  // legend and dot-size scale are always drawn from, so neither shifts
  // under the viewer while frames play (a legend growing a row as a new
  // tag first appears would resize and refit the whole graph).
  const baseBuilt = useMemo(
    () => buildPeopleNetwork(data, { minMentions, strictness, range: null }),
    [data, minMentions, strictness],
  );

  // Cumulative frames: each one is [first logged day, that month's end].
  // There's no separate Period control any more (#437 feedback): the
  // scrubber *is* the time control — parking it on a month shows the
  // network as it stood then — so a second range slider above the graph
  // only duplicated it.
  const frames = useMemo(() => (extent ? monthlyFrameEnds(extent[0], extent[1]) : []), [extent]);
  const lastFrame = frames.length - 1;
  // The last frame *is* the full period, so it reuses baseBuilt rather
  // than building the same graph twice.
  const shownFrame = frame !== null && frame < lastFrame ? frame : null;
  const atEnd = frame !== null && frame >= lastFrame;
  const isPlaying = playing && !atEnd;

  const built = useMemo(() => {
    if (shownFrame === null) return baseBuilt;
    return buildPeopleNetwork(data, { minMentions, strictness, range: [extent![0], frames[shownFrame]] });
  }, [shownFrame, baseBuilt, extent, data, minMentions, strictness, frames]);

  // The clock. Stops on its own at the last frame (isPlaying goes false,
  // which tears this down) rather than looping — the end state is the
  // full graph, which is the natural place to stop and look.
  const framesPerSecond = SPEEDS.find((sp) => sp.id === speed)!.framesPerSecond;
  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setFrame((f) => Math.min(lastFrame, (f ?? -1) + 1));
    }, 1000 / framesPerSecond);
    return () => window.clearInterval(id);
  }, [isPlaying, framesPerSecond, lastFrame]);

  const handlePlayPause = () => {
    if (isPlaying) {
      setPlaying(false);
      return;
    }
    // From the static view or the end, a Play starts over from the first
    // month — the time-lapse is about watching it grow.
    if (frame === null || atEnd) setFrame(0);
    setPlaying(true);
  };
  const handleRestart = () => {
    setFrame(0);
    setPlaying(true);
  };
  const pause = useCallback(() => setPlaying(false), []);

  const visibleNodes = useMemo(
    () => built.nodes.filter((n) => !hiddenTags.has(tagKey(n.tagId))),
    [built.nodes, hiddenTags],
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => built.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [built.edges, visibleIds],
  );

  // What the primitive sees. Memoised separately from the richer rows
  // above: these are rebuild dependencies, so they must only change when
  // the graph actually does, not when the selection or search text does.
  const networkNodes = useMemo<NetworkNode[]>(
    () => visibleNodes.map((n) => ({ id: n.id, label: n.name, count: n.count })),
    [visibleNodes],
  );
  const networkEdges = useMemo<NetworkEdge[]>(
    () => visibleEdges.map((e) => ({ source: e.source, target: e.target, weight: e.overlap })),
    [visibleEdges],
  );

  // Keyed off the full people list rather than the built graph, so the
  // callback (a rebuild dependency) stays stable across filter changes.
  const personById = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people]);
  const color = useCallback(
    (n: NetworkNode) => personById.get(n.id as number)?.color ?? UNTAGGED_COLOR,
    [personById],
  );

  // The size scale tops out at the busiest person in the period, hidden
  // tags included — hiding a group shouldn't resize everyone else.
  const maxCount = useMemo(() => Math.max(1, ...baseBuilt.nodes.map((n) => n.count)), [baseBuilt.nodes]);

  const builtById = useMemo(() => new Map(built.nodes.map((n) => [n.id, n])), [built.nodes]);
  const degree = useMemo(() => {
    const map = new Map<number, number>();
    for (const e of visibleEdges) {
      map.set(e.source, (map.get(e.source) ?? 0) + 1);
      map.set(e.target, (map.get(e.target) ?? 0) + 1);
    }
    return map;
  }, [visibleEdges]);

  const tooltip = useCallback(
    (n: NetworkNode) => {
      const row = builtById.get(n.id as number);
      const connections = degree.get(n.id as number) ?? 0;
      return {
        title: n.label,
        rows: [
          { label: row?.tagName ?? "Untagged", value: `${n.count} days`, color: color(n) },
          {
            label: "connections",
            value: String(connections),
            color: "var(--muted-foreground)",
          },
        ],
      };
    },
    [builtById, degree, color],
  );

  // Legend: every tag among the people in the selected period (not just
  // the current time-lapse frame — see baseBuilt), plus any the viewer has
  // hidden (or hiding one would remove its own toggle).
  // Alphabetical with Untagged last — a fixed order, never by size, so a
  // tag doesn't hop around the legend as the period changes.
  const legendSeries = useMemo(() => {
    const present = new Set([...baseBuilt.nodes.map((n) => tagKey(n.tagId)), ...hiddenTags]);
    const byKey = new Map<string, { id: string; label: string; color: string }>();
    for (const p of data.people) {
      const key = tagKey(p.tagId);
      if (byKey.has(key) || !present.has(key)) continue;
      byKey.set(key, { id: key, label: p.tagName ?? "Untagged", color: p.color ?? UNTAGGED_COLOR });
    }
    return [...byKey.values()].sort((a, b) =>
      a.id === UNTAGGED_KEY ? 1 : b.id === UNTAGGED_KEY ? -1 : a.label.localeCompare(b.label),
    );
  }, [data.people, baseBuilt.nodes, hiddenTags]);

  const toggleTag = useCallback((id: string) => {
    setHiddenTags((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // A selection whose person has been filtered out simply lapses.
  const effectiveSelected = selectedId !== null && visibleIds.has(selectedId) ? selectedId : null;
  const selected = effectiveSelected === null ? null : builtById.get(effectiveSelected) ?? null;
  const selectedTies = useMemo(() => {
    if (effectiveSelected === null) return [];
    return visibleEdges
      .filter((e) => e.source === effectiveSelected || e.target === effectiveSelected)
      .map((e) => ({ edge: e, other: builtById.get(e.source === effectiveSelected ? e.target : e.source)! }))
      .sort((a, b) => b.edge.overlap - a.edge.overlap || b.edge.shared - a.edge.shared);
  }, [effectiveSelected, visibleEdges, builtById]);

  const onSelect = useCallback((id: string | number | null) => setSelectedId(id as number | null), []);

  const nameToId = useMemo(() => new Map(visibleNodes.map((n) => [n.name.toLowerCase(), n.id])), [visibleNodes]);

  return (
    <ChartPage
      title="People Network"
      description="Who I spend time with, and with whom. Everyone logged on enough days is a dot; a line means two people are logged together more often than chance would explain."
      info={{
        interactionGuide: NETWORK_INTERACTION_GUIDE,
        methodology: PEOPLE_NETWORK_METHODOLOGY,
        trackingSpan: PEOPLE_TRACKING_SPAN,
      }}
      filters={
        <>
          <GroupByPicker
            value={String(minMentions)}
            onChange={(id) => setMinMentions(Number(id))}
            options={MIN_MENTION_PICKER}
            label="Min. days"
          />
          <GroupByPicker value={strictness} onChange={setStrictness} options={STRICTNESS_OPTIONS} label="Connections" />
          <div className="flex flex-col gap-1">
            <label
              htmlFor="people-network-search"
              className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Find person
            </label>
            <Input
              id="people-network-search"
              list="people-network-names"
              value={search}
              placeholder="Name…"
              className="h-8 w-44 text-sm"
              onChange={(event) => {
                const value = event.target.value;
                setSearch(value);
                const id = nameToId.get(value.trim().toLowerCase());
                if (id !== undefined) setSelectedId(id);
              }}
            />
            <datalist id="people-network-names">
              {visibleNodes.map((n) => (
                <option key={n.id} value={n.name} />
              ))}
            </datalist>
          </div>
        </>
      }
    >
      <ChartCard empty={data.days.length === 0}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
            <Legend series={legendSeries} onToggle={toggleTag} hiddenIds={hiddenTags} className="text-xs" />
            {/* The accessible reading of the time-lapse: announced only once
                it's settled (paused or scrubbed), not on every frame, the
                same rule the bar race's live region follows. Kept inside this
                row: as its own item in the column, its flex gap alone pushed
                the card past the viewport's bottom edge. */}
            <div role="status" aria-live="polite" className="sr-only">
              {frame !== null && !isPlaying && frames[frame]
                ? `${formatDate(toDateString(frames[frame]), "monthYear")}: ${visibleNodes.length} people, ${visibleEdges.length} connections`
                : ""}
            </div>
            <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {visibleNodes.length} people · {visibleEdges.length} connections · {built.dayCount} days
            </p>
          </div>
          <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport="below-filters" minWidth={320}>
            {({ width, height }) =>
              // Outside the time-lapse an empty period gets a message; inside
              // it the graph stays mounted even while empty (the first months
              // rarely have anyone at 10+ days yet) — unmounting would drop
              // every remembered position, and the time-lapse depends on
              // those to grow smoothly.
              networkNodes.length === 0 && frame === null ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nobody was logged on {minMentions}+ days in this period.
                </p>
              ) : (
                <>
                  <InteractiveNetwork
                    nodes={networkNodes}
                    edges={networkEdges}
                    width={width}
                    height={height}
                    color={color}
                    radiusDomainMax={maxCount}
                    selectedId={effectiveSelected}
                    onSelect={onSelect}
                    onNodeDragStart={pause}
                    // The details panel (w-64 at left-2, plus a gap) covers
                    // this much of the graph once someone's selected. On a
                    // narrow screen it covers most of the width anyway, so
                    // framing around it would leave nothing to frame into.
                    focusInsetLeft={width >= 640 ? 280 : 0}
                    tooltip={tooltip}
                    ariaLabel="People network. Each dot is a person, sized by days logged and coloured by tag; lines join people logged together more often than chance. Drag a person to pull them around, scroll to zoom, click to see who they're most often with."
                  />
                  {frame !== null && frames[frame] ? (
                    // The frame's date, large and quiet, where the eye can
                    // find it without leaving the graph — the same job the
                    // bar race's period label does.
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1 right-3 font-heading text-3xl text-muted-foreground/70 tabular-nums select-none md:text-4xl"
                    >
                      {formatDate(toDateString(frames[frame]), "monthYear")}
                    </span>
                  ) : null}
                  {selected ? (
                    <DetailsPanel
                      person={selected}
                      color={color({ id: selected.id, label: selected.name, count: selected.count })}
                      ties={selectedTies}
                      onPick={setSelectedId}
                      onClose={() => setSelectedId(null)}
                    />
                  ) : null}
                </>
              )
            }
          </ResponsiveChart>
          {/* Under the graph, like the bar race's row. The chart's
              "below-filters" sizing measures whatever sits beneath it in
              this column and leaves room for it, so this row still lands
              on screen once the page header scrolls away. */}
          {frames.length > 1 ? (
            <PlaybackControls
              playing={isPlaying}
              frame={frame ?? lastFrame}
              lastFrame={lastFrame}
              speed={speed}
              onPlayPause={handlePlayPause}
              onRestart={handleRestart}
              onScrub={(f) => {
                setPlaying(false);
                setFrame(f);
              }}
              onSpeed={setSpeed}
              startLabel={formatDate(toDateString(frames[0]), "monthYear")}
              endLabel={formatDate(toDateString(frames[lastFrame]), "monthYear")}
            />
          ) : null}
        </div>
      </ChartCard>
    </ChartPage>
  );
}

/** Play/Pause, Restart, a scrubber and speed — laid out and labelled like
 * InteractiveBarRace's control row, so the two time-lapses in the app
 * read as one control. Frames are whole months (see monthlyFrameEnds), so
 * the scrubber steps by one rather than the bar race's fractional
 * positions: there's no in-between graph to interpolate to. */
function PlaybackControls({
  playing,
  frame,
  lastFrame,
  speed,
  onPlayPause,
  onRestart,
  onScrub,
  onSpeed,
  startLabel,
  endLabel,
}: {
  playing: boolean;
  frame: number;
  lastFrame: number;
  speed: SpeedId;
  onPlayPause: () => void;
  onRestart: () => void;
  onScrub: (frame: number) => void;
  onSpeed: (speed: SpeedId) => void;
  /** The scrubber's two ends, now that it's the page's only time control. */
  startLabel: string;
  endLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="xs" variant="secondary" onClick={onPlayPause} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-3.5" />}
        {playing ? "Pause" : "Play"}
      </Button>
      <Button type="button" size="xs" variant="ghost" onClick={onRestart} aria-label="Restart">
        <RotateCcw aria-hidden className="size-3.5" />
        Restart
      </Button>
      <label htmlFor="people-network-scrub" className="sr-only">
        Scrub through time
      </label>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{startLabel}</span>
      <input
        id="people-network-scrub"
        type="range"
        min={0}
        max={lastFrame}
        step={1}
        value={frame}
        onChange={(event) => onScrub(Number(event.target.value))}
        className="h-1.5 min-w-40 flex-1 cursor-pointer accent-[var(--chart-1)]"
      />
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{endLabel}</span>
      <div role="group" aria-label="Speed" className="flex items-center gap-1">
        {SPEEDS.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="xs"
            variant={speed === option.id ? "secondary" : "ghost"}
            aria-pressed={speed === option.id}
            onClick={() => onSpeed(option.id)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

type Tie = {
  edge: { shared: number; overlap: number };
  other: { id: number; name: string; count: number };
};

/** The selected person's strongest ties, ranked by overlap (not raw shared
 * days, for the same reason edges are weighted by it — see
 * people-network.ts). Also the keyboard/screen-reader route through the
 * graph: every tie is a button that moves the selection along it. */
function DetailsPanel({
  person,
  color,
  ties,
  onPick,
  onClose,
}: {
  person: { name: string; count: number; tagName: string | null; first: string; last: string };
  color: string;
  ties: Tie[];
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute top-2 left-2 z-10 flex max-h-[calc(100%-1rem)] w-64 max-w-[calc(100%-5rem)] flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-card/95 p-3 text-xs shadow-md backdrop-blur-sm [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{person.name}</span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <SeriesKey color={color} />
            {person.tagName ?? "Untagged"}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Close details"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      <p className="text-muted-foreground tabular-nums">
        {person.count} days · {formatDate(person.first, "monthYear")} – {formatDate(person.last, "monthYear")}
      </p>
      {ties.length === 0 ? (
        <p className="text-muted-foreground">No ties clear the significance bar at this setting.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Most often with
          </span>
          <ol className="flex flex-col">
            {ties.slice(0, PANEL_CONNECTIONS).map(({ edge, other }) => (
              <li key={other.id}>
                <button
                  type="button"
                  onClick={() => onPick(other.id)}
                  className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
                >
                  <span className="truncate">{other.name}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {edge.shared}d · {formatPercent(edge.overlap)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {ties.length > PANEL_CONNECTIONS ? (
            <span className="text-muted-foreground">+{ties.length - PANEL_CONNECTIONS} more</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
