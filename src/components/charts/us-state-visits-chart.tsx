"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import statesTopologyRaw from "us-atlas/states-10m.json";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartPage } from "@/components/charts/chart-page";
import { CHART_HEIGHT_CLASS, ResponsiveChart } from "@/components/charts/responsive-chart";
import { InteractiveGeo, type GeoExpansion, type GeoFeature } from "@/components/charts/interactive/interactive-geo";
import {
  isAlbersUsaDrawable,
  loadAllUsCountyFeatures,
  loadUsCountyFeatures,
  loadUsMetroFeatures,
  usCountiesExpansion,
  usProjection,
  type UsStateProperties,
} from "@/components/charts/us-geo-levels";
import { GroupByPicker } from "@/components/charts/interactive/group-by-picker";
import { CBSA_AREAS } from "@/lib/geo/us-cbsa";
import type { FeatureCollection, Geometry } from "geojson";
import { GEO_INTERACTION_GUIDE } from "@/lib/viz/interaction-guides";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";
import type { UsCountyVisitData, UsStateVisitEntry } from "@/lib/charts";

// us-atlas's states-10m.json (~114KB), the standard/published-geography
// path #163 locked in — no custom TopoJSON committed for this chart, the
// same way world-visits-chart.tsx leans on world-atlas. Decoded to GeoJSON
// client-side rather than on the server for the reason that file spells
// out in full: decoded GeoJSON is several times larger than the TopoJSON
// it comes from, so shipping the compact form over the wire and decoding
// here is what keeps the size win.
//
// Statically imported here, unlike the county layer (loaded on demand in
// us-geo-levels.ts): states *are* this page, so there's nothing to defer.
//
// The 10m file, not us-atlas's *-albers-10m sibling: the albers files are
// pre-projected into screen coordinates and want d3.geoIdentity, which
// isn't a GeoProjection and so doesn't fit InteractiveGeo's `projection`
// prop without a cast. Projecting real lon/lat here costs nothing
// measurable and keeps the primitive's contract honest.
const statesTopology = statesTopologyRaw as unknown as Topology<{
  states: GeometryCollection<UsStateProperties>;
}>;

/**
 * The three ways to read this map (#313).
 *
 * They're modes rather than zoom levels because they answer different
 * questions, and two of them can't be reached by drilling. "Drill" is the
 * interactive state→county view #107 shipped. "County" is that same county
 * granularity nationally, without having to open states one at a time.
 * "Metro" dissolves each CBSA into a single polygon — which has to be
 * national, since 43 metropolitan areas cross state lines and a
 * state-scoped version would cut them in half.
 */
export type UsMapMode = "drill" | "county" | "metro";

const MODE_OPTIONS: { id: UsMapMode; label: string }[] = [
  { id: "drill", label: "Drill down" },
  { id: "county", label: "Counties" },
  { id: "metro", label: "Metros" },
];

/** The one-line description under the page title. Per mode, because the
 * old single line ("click a state to drill into its counties") is only
 * true in one of the three now. */
const DESCRIPTIONS: Record<UsMapMode, string> = {
  drill: "Distinct days logged in each US state. Click a state to drill into its counties.",
  county: "Distinct days logged in each US county.",
  metro:
    "Distinct days logged in each US metropolitan and micropolitan area. Counties belonging to no such area are drawn on their own.",
};

const ARIA_LABELS: Record<UsMapMode, string> = {
  drill:
    "Map of the United States, with each state shaded by how many days you've logged there. Scroll or pinch to zoom, drag to pan. Click a state to break it into its counties in place; neighbouring states stay on the map and can be opened too. Hover a state or county to see its exact count.",
  county:
    "Map of the United States drawn as counties, each shaded by how many days you've logged there. Scroll or pinch to zoom, drag to pan. Hover a county to see its exact count.",
  metro:
    "Map of the United States drawn as metropolitan and micropolitan statistical areas, each shaded by how many days you've logged there. Counties belonging to no such area are drawn individually. Scroll or pinch to zoom, drag to pan. Hover an area to see its exact count.",
};

/** Every polygon this map can draw carries a name; that's all the chart
 * itself needs from a feature's properties. The level-specific shapes
 * (a county's, a metro's) stay in us-geo-levels.ts. */
type NamedProperties = { name: string };
type NamedFeatures = FeatureCollection<Geometry, NamedProperties>;

export function UsStateVisitsChart({ data, counties }: { data: UsStateVisitEntry[]; counties: UsCountyVisitData }) {
  const [mode, setMode] = useState<UsMapMode>("drill");
  const features = useMemo(() => {
    const decoded = feature(statesTopology, statesTopology.objects.states);
    // Territories dropped — see isAlbersUsaDrawable's own comment, and
    // `offMapEntries` below for where their days go instead.
    return { ...decoded, features: decoded.features.filter((f) => isAlbersUsaDrawable(f.id)) };
  }, []);

  const daysByState = useMemo(() => {
    const map = new Map<string, number>();
    // Summed rather than overwritten, same defensive reasoning
    // world-visits-chart.tsx gives: getUsStateVisitData already merges by
    // resolved feature name, so this never actually double-counts today —
    // but if two catalog spellings ever normalize onto one state, losing
    // one silently would be worse than adding them.
    for (const entry of data) map.set(entry.state, (map.get(entry.state) ?? 0) + entry.days);
    return map;
  }, [data]);

  const daysByCountyFips = useMemo(
    () => new Map(counties.counties.map((c) => [c.fips, c.days])),
    [counties],
  );

  /**
   * Values for the metro view, keyed the way its features are: by CBSA
   * code for a dissolved area, by county FIPS for the counties that belong
   * to none.
   *
   * A metro's days are the sum of its member counties' rather than a fresh
   * point-in-polygon pass over every logged place. Counties tile a CBSA
   * exactly — that's what a CBSA *is*, a set of whole counties — so the sum
   * is not an approximation, and re-running the spatial join would be a lot
   * of work to arrive at the same number.
   */
  const metroValues = useMemo(() => {
    const values = new Map<string, number>();
    const claimed = new Set<string>();
    for (const [code, area] of Object.entries(CBSA_AREAS)) {
      let total = 0;
      let any = false;
      for (const fips of area.counties) {
        claimed.add(fips);
        const days = daysByCountyFips.get(fips);
        if (days !== undefined) {
          total += days;
          any = true;
        }
      }
      // Only set a value where there's something to show — a CBSA with no
      // logged days should read as "no data" (muted), not as a real zero.
      if (any) values.set(code, total);
    }
    for (const [fips, days] of daysByCountyFips) {
      if (!claimed.has(fips)) values.set(fips, days);
    }
    return values;
  }, [daysByCountyFips]);

  // The county and metro views both need the 842KB county layer, so both
  // load on demand rather than shipping with the page. `level` holds
  // whichever one is currently drawn; `drill` needs nothing loaded because
  // its base map is the statically-imported state layer.
  const [level, setLevel] = useState<{ mode: UsMapMode; features: NamedFeatures } | null>(null);
  // Which mode's load failed, if any. Only set from a promise rejection, so
  // "loading" itself never needs to be state — see `showingRequestedMode`
  // below, which derives it from what's actually drawn.
  const [failedMode, setFailedMode] = useState<UsMapMode | null>(null);

  useEffect(() => {
    if (mode === "drill") return;
    let cancelled = false;
    const load = mode === "county" ? loadAllUsCountyFeatures() : loadUsMetroFeatures();
    load
      .then((loaded) => {
        // Guarded against the mode being switched again while this was in
        // flight — otherwise a slow county load can land after the user has
        // already moved to metros and replace what they're looking at.
        if (!cancelled) setLevel({ mode, features: loaded as NamedFeatures });
      })
      .catch(() => {
        if (!cancelled) setFailedMode(mode);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Days that resolved to a real us-atlas feature the map above can't
  // draw — in practice the US Virgin Islands, which this catalog has real
  // logged days in. Surfaced as a line of text under the chart rather than
  // dropped: "the projection can't place it" is a fine reason not to color
  // a polygon, and a terrible reason to make someone's logged days
  // disappear from the page entirely.
  const offMapEntries = useMemo(() => {
    const drawn = new Set(features.features.map((f) => f.properties.name));
    return data.filter((entry) => !drawn.has(entry.state));
  }, [data, features]);

  /** Clicking a state replaces its polygon with its own counties, drawn
   * in place inside the outline it just occupied (#107). Returns a promise
   * rather than an expansion, so the 842KB county layer is fetched on this
   * click instead of shipped with the page — see loadUsCountyFeatures. */
  const resolveExpansion = useCallback(
    (f: GeoFeature): Promise<GeoExpansion | null> => {
      const stateFips = String(f.id);
      const stateName = String(f.properties?.name ?? "");
      return loadUsCountyFeatures(stateFips).then((countyFeatures) =>
        // A state whose counties somehow didn't load keeps its own
        // polygon rather than being replaced by nothing at all.
        countyFeatures.features.length === 0
          ? null
          : usCountiesExpansion(stateName, stateFips, countyFeatures, daysByCountyFips),
      );
    },
    [daysByCountyFips],
  );

  // What's actually drawn, per mode. `drill` keeps the state layer and its
  // click-to-expand behaviour; the other two swap the base map wholesale
  // and expand into nothing, because they're already at their own
  // granularity.
  const shown: NamedFeatures = mode === "drill" || level?.mode !== mode ? features : level.features;
  const showingRequestedMode = mode === "drill" || level?.mode === mode;

  return (
    <ChartPage
      title="US Heatmap"
      description={DESCRIPTIONS[mode]}
      info={{ interactionGuide: GEO_INTERACTION_GUIDE, methodology: PLACES_METHODOLOGY }}
      filters={<GroupByPicker value={mode} onChange={setMode} options={MODE_OPTIONS} label="View" />}
    >
      <ChartCard
        // Only the whole-country case is empty here — a state you've never
        // been to is a real, meaningful zero, and InteractiveGeo already
        // renders it as a muted "no data" fill with its own tooltip row
        // rather than a gap. Blanking the card because 18 states have no
        // days would throw away the most interesting thing the map says.
        empty={data.length === 0}
      >
      <ResponsiveChart className={CHART_HEIGHT_CLASS} fillViewport minWidth={360}>
        {({ width, height }) => (
          <InteractiveGeo<NamedProperties>
            // Remounted per mode rather than re-fed: InteractiveGeo holds
            // its expanded region in internal state, and switching the base
            // map out from under a state that's currently broken into
            // counties would leave that expansion orphaned on top of a map
            // it no longer belongs to.
            key={mode}
            features={shown}
            width={width}
            height={height}
            // geoAlbersUsa, not this primitive's geoNaturalEarth1 default
            // (built for whole-world extents) and not geoMercator (which
            // would stretch Alaska across the top and leave the lower 48
            // squeezed into a corner): the composite is the one projection
            // that renders all 50 states together at one honest, roughly
            // equal-area scale — exactly the comparison a per-state
            // choropleth is asking the reader to make. Counties expand
            // into this same projection, which is what lands them inside
            // the outline their state occupied.
            projection={usProjection}
            getValue={(f) =>
              mode === "drill"
                ? daysByState.get(f.properties.name) ?? null
                : // Both flat views key by feature id — county FIPS, or a
                  // CBSA code for a dissolved metro — never by name, since
                  // county names repeat across states.
                  (mode === "county" ? daysByCountyFips : metroValues).get(String(f.id)) ?? null
            }
            getLabel={(f) => f.properties.name}
            valueLabel="days"
            resolveExpansion={mode === "drill" ? resolveExpansion : undefined}
            ariaLabel={ARIA_LABELS[mode]}
          />
        )}
      </ResponsiveChart>
      {!showingRequestedMode ? (
        <p className="pt-3 text-xs text-muted-foreground">
          {failedMode === mode
            ? "County geometry couldn't be loaded, so this view is showing states instead."
            : "Loading county geometry…"}
        </p>
      ) : null}
      {offMapEntries.length > 0 ? (
        <p className="pt-3 text-xs text-muted-foreground">
          Not drawn on this map:{" "}
          {offMapEntries.map((e) => `${e.state} (${e.days} ${e.days === 1 ? "day" : "days"})`).join(", ")} — the
          composite US projection covers the 50 states and DC only.
        </p>
      ) : null}
      {counties.unresolvedDays > 0 ? (
        <p className="pt-1 text-xs text-muted-foreground">
          {counties.unresolvedDays} {counties.unresolvedDays === 1 ? "day" : "days"} in the US couldn&apos;t be placed
          in a county — usually an address geocoded just offshore. Counted in the state totals, missing once a
          state is broken into counties.
        </p>
      ) : null}
      </ChartCard>
    </ChartPage>
  );
}
