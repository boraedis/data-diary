"use client";

import { useMemo } from "react";
import {
  CompositionExplorer,
  rankCategories,
  type CompositionRow,
} from "@/components/charts/composition-explorer";
import type { CountryDay } from "@/lib/charts";
import { colorByScheme } from "@/lib/viz/color";
import { PLACES_METHODOLOGY } from "@/lib/viz/methodology";
import { PLACES_TRACKING_SPAN } from "@/lib/viz/tracking-span";

// See coffee-charts.tsx for why this thin client layer exists: the shared
// explorers take formatter functions, which a server-component page can't
// pass across the boundary.

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
export function PlaceHistoryChart({
  data,
  countryColors,
}: {
  data: CountryDay[];
  /** Country name -> the colour set on its place (`getCountryColors`). */
  countryColors: Record<string, string>;
}) {
  // Every country is its own band (#456), not a top five plus "Other",
  // coloured by the colour set on its place - the same one the rest of the
  // app uses for it. A country with none takes the pale tail colour, so
  // the long tail of holidays recedes and the chart still reads as where
  // life happened, but each trip stays named on hover.
  const categories = useMemo(() => {
    const totals = new Map<string, number>();
    for (const day of data) {
      for (const country of day.countries) {
        totals.set(country, (totals.get(country) ?? 0) + 1);
      }
    }
    return colorByScheme(rankCategories(totals), (country) => countryColors[country]);
  }, [data, countryColors]);

  const rows = useMemo<CompositionRow[]>(
    () =>
      data.map((day) => {
        const values: Record<string, number> = {};
        for (const country of day.countries) {
          values[country] = (values[country] ?? 0) + 1;
        }
        return { date: day.date, values };
      }),
    [data],
  );

  return (
    <CompositionExplorer
      rows={rows}
      categories={categories}
      title="Location Mix"
      description="A breakdown of which countries you spent your time in, aggregated by period. A day spanning two countries counts in both."
      methodology={PLACES_METHODOLOGY}
      trackingSpan={PLACES_TRACKING_SPAN}
      valueFormat={(v) => `${Math.round(v)} day${v === 1 ? "" : "s"}`}
      ariaLabel="Which countries you were in over time, as a share of logged days."
    />
  );
}
