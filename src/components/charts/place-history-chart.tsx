"use client";

import { useMemo } from "react";
import {
  CompositionExplorer,
  foldToTopCategories,
  OTHER_ID,
  type CompositionRow,
} from "@/components/charts/composition-explorer";
import type { CountryDay } from "@/lib/charts";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";

// See coffee-charts.tsx for why this thin client layer exists: the shared
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

/**
 * Five countries plus "Other".
 *
 * Countries are the one level of the place tree with few enough members to
 * sit inside a categorical palette, and even then the tail is long — most
 * countries are a holiday rather than a place you lived. Folding them keeps
 * the chart about where life actually happened.
 */
const MAX_COUNTRIES = 5;

/**
 * Where you were, over time.
 *
 * A day counts once per country it touched, so a travel day spanning two
 * shows in both — this is "was I there", the same reading
 * `getCountryVisitData` and the world map use, not a weighted tally of
 * which slot a place filled.
 *
 * Share mode is the interesting one: it turns the chart into a picture of
 * moving, where a stacked count mostly just tracks how much was logged.
 */
export function PlaceHistoryChart({ data }: { data: CountryDay[] }) {
  const { categories, keep } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const day of data) {
      for (const country of day.countries) {
        totals.set(country, (totals.get(country) ?? 0) + 1);
      }
    }
    return foldToTopCategories(totals, MAX_COUNTRIES);
  }, [data]);

  const rows = useMemo<CompositionRow[]>(
    () =>
      data.map((day) => {
        const values: Record<string, number> = {};
        for (const country of day.countries) {
          const id = keep.has(country) ? country : OTHER_ID;
          values[id] = (values[id] ?? 0) + 1;
        }
        return { date: day.date, values };
      }),
    [data, keep],
  );

  return (
    <CompositionExplorer
      rows={rows}
      categories={categories}
      title="Location Mix"
      description="A breakdown of which countries you spent your time in, aggregated by period. A day spanning two countries counts in both."
      methodology={PLACES_METHODOLOGY}
      valueFormat={(v) => `${Math.round(v)} day${v === 1 ? "" : "s"}`}
      ariaLabel="Which countries you were in over time, as a share of logged days."
    />
  );
}
