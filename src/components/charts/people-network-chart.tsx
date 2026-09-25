"use client";

import { useCallback, useMemo, useState } from "react";
import { X } from "lucide-react";
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
import { TimeRangePicker } from "@/components/charts/interactive/time-range-picker";
import { Input } from "@/components/ui/input";
import { parseDate } from "@/lib/date";
import {
  buildPeopleNetwork,
  MIN_MENTION_OPTIONS,
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

function tagKey(tagId: number | null): string {
  return tagId === null ? UNTAGGED_KEY : String(tagId);
}

export function PeopleNetworkChart({ data }: { data: PeopleNetworkInput }) {
  const [minMentions, setMinMentions] = useState<number>(DEFAULT_MIN_MENTIONS);
  const [strictness, setStrictness] = useState<NetworkStrictness>("significant");
  const [range, setRange] = useState<[Date, Date] | null>(null);
  const [hiddenTags, setHiddenTags] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const extent = useMemo<[Date, Date] | null>(() => {
    if (data.days.length === 0) return null;
    return [parseDate(data.days[0].date), parseDate(data.days[data.days.length - 1].date)];
  }, [data.days]);

  const built = useMemo(
    () => buildPeopleNetwork(data, { minMentions, strictness, range }),
    [data, minMentions, strictness, range],
  );

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
  const maxCount = useMemo(() => Math.max(1, ...built.nodes.map((n) => n.count)), [built.nodes]);

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

  // Legend: every tag among the people currently in the graph, plus any
  // the viewer has hidden (or hiding one would remove its own toggle).
  // Alphabetical with Untagged last — a fixed order, never by size, so a
  // tag doesn't hop around the legend as the period changes.
  const legendSeries = useMemo(() => {
    const present = new Set([...built.nodes.map((n) => tagKey(n.tagId)), ...hiddenTags]);
    const byKey = new Map<string, { id: string; label: string; color: string }>();
    for (const p of data.people) {
      const key = tagKey(p.tagId);
      if (byKey.has(key) || !present.has(key)) continue;
      byKey.set(key, { id: key, label: p.tagName ?? "Untagged", color: p.color ?? UNTAGGED_COLOR });
    }
    return [...byKey.values()].sort((a, b) =>
      a.id === UNTAGGED_KEY ? 1 : b.id === UNTAGGED_KEY ? -1 : a.label.localeCompare(b.label),
    );
  }, [data.people, built.nodes, hiddenTags]);

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
          {extent ? (
            <TimeRangePicker domain={extent} value={range} onChange={setRange} label="Period" />
          ) : null}
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
            <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {visibleNodes.length} people · {visibleEdges.length} connections · {built.dayCount} days
            </p>
          </div>
          <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={320}>
            {({ width, height }) =>
              networkNodes.length === 0 ? (
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
                    tooltip={tooltip}
                    ariaLabel="People network. Each dot is a person, sized by days logged and coloured by tag; lines join people logged together more often than chance. Drag a person to pull them around, scroll to zoom, click to see who they're most often with."
                  />
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
        </div>
      </ChartCard>
    </ChartPage>
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
