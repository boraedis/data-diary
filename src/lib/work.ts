import type { CommuteOption, DayType, WorkLocationOption } from "@/db/schema";
import { DAY_TYPE_LABELS, DAY_TYPE_ORDER } from "@/lib/viz/day-type";

// Pure shaping for the Work charts (#444) — which number a day contributes
// under each measure, and which group a day falls in for Work vs.
// Happiness. No DB access and no React, the same split `life-timeline.ts`
// has from its chart, so the rules are unit-testable on their own.
//
// A data note that shapes several choices below: hours and productivity
// have only been logged since 2026-05-11, while `dayType = "work"` goes
// back years. Anything that needs years of history (the job leaderboard's
// days-worked measure, the day-type grouping) reads `dayType`; anything
// about *how much* or *how well* reads the two newer columns.

/** One day's work fields, plus the happiness/day-type context the Work vs.
 * Happiness chart groups by. Every field is nullable independently — a day
 * can log a location without hours, or hours without productivity.
 *
 * `locations`/`commute` are normalized so that an empty array and a null
 * column both arrive as `[]`: before work location was tracked, the column
 * was backfilled with `{}` rather than left null, so "empty" can only mean
 * "not recorded" — never "worked nowhere". */
export type WorkDay = {
  date: string;
  minutes: number | null;
  productivity: number | null;
  locations: WorkLocationOption[];
  commute: CommuteOption[];
  dayType: DayType | null;
  happiness: number | null;
};

// --- Measures ---------------------------------------------------------------

/**
 * - `hours`: time worked.
 * - `productivity`: the self-rated 0–100 score, shown as a percentage.
 * - `productiveHours`: hours × productivity% — an 8h day at 50% and a 4h
 *   day at 100% both come out at 4 productive hours. Only defined on days
 *   that log *both*; a missing productivity isn't treated as 100% (or 0%).
 */
export type WorkMeasure = "hours" | "productivity" | "productiveHours";

export const WORK_MEASURE_LABELS: Record<WorkMeasure, string> = {
  hours: "Hours worked",
  productivity: "Productivity",
  productiveHours: "Productive hours",
};

/** A day's value under `measure`, or `undefined` when the day doesn't log
 * what that measure needs — `TrendExplorer`'s "exclude from this bucket"
 * contract, rather than a 0 that would drag an average down. */
export function workMeasureValue(day: WorkDay, measure: WorkMeasure): number | undefined {
  switch (measure) {
    case "hours":
      return day.minutes === null ? undefined : day.minutes / 60;
    case "productivity":
      return day.productivity ?? undefined;
    case "productiveHours":
      return day.minutes === null || day.productivity === null
        ? undefined
        : (day.minutes / 60) * (day.productivity / 100);
  }
}

// --- Location / commute labels ---------------------------------------------

/** Every work location, in legend and group order, most often logged
 * first. Colours are named per location (`@/lib/viz/work`), not by slot,
 * so this order only decides where each one sits in a list. */
export const WORK_LOCATION_ORDER: readonly WorkLocationOption[] = ["home", "office", "cafe", "travel", "other"];

export const WORK_LOCATION_LABELS: Record<WorkLocationOption, string> = {
  home: "Home",
  office: "Office",
  cafe: "Cafe",
  travel: "Travelling",
  other: "Other",
};

/** Commute modes in legend order, most often logged first. Colours are
 * named per mode (`@/lib/viz/work`). `none` is not a schema value: see
 * `commuteCategories`. */
export const COMMUTE_ORDER = ["public_transit", "walk", "none", "car", "bike", "taxi", "carpool", "other"] as const;
export type CommuteCategory = (typeof COMMUTE_ORDER)[number];

export const COMMUTE_LABELS: Record<CommuteCategory, string> = {
  public_transit: "Public transit",
  walk: "Walk",
  none: "No commute",
  car: "Car",
  bike: "Bike",
  taxi: "Taxi",
  carpool: "Carpool",
  other: "Other",
};

/**
 * A day's commute, as calendar categories.
 *
 * A day that logs a work location but no commute is a real "no commute"
 * day — every home-only day in the data looks exactly like that — so it
 * gets its own `none` category rather than being dropped. A day with
 * *neither* logged is untracked and returns `[]`, same as the location
 * calendar.
 */
export function commuteCategories(day: WorkDay): CommuteCategory[] {
  if (day.commute.length > 0) return day.commute;
  return day.locations.length > 0 ? ["none"] : [];
}

// --- Work vs. Happiness groupings ------------------------------------------

export type HappinessGrouping = "hours" | "productivity" | "location" | "dayType";

/** One row of the Work vs. Happiness chart: a named group and the happiness
 * of every day in it. `order` fixes row order independently of which
 * groups the data happens to fill. */
export type HappinessGroup = { id: string; label: string; order: number; values: { date: string; value: number }[] };

type Band = { id: string; label: string; min: number; max: number };

/** Hours bands. Two-hour steps through the typical day, open-ended at both
 * ends. Fixed edges rather than quantiles so a band means the same thing
 * as more days are logged — "6–8h" shouldn't quietly become "6.5–7.75h". */
export const HOURS_BANDS: readonly Band[] = [
  { id: "lt4", label: "Under 4h", min: -Infinity, max: 4 },
  { id: "4-6", label: "4–6h", min: 4, max: 6 },
  { id: "6-8", label: "6–8h", min: 6, max: 8 },
  { id: "8-10", label: "8–10h", min: 8, max: 10 },
  { id: "10+", label: "10h+", min: 10, max: Infinity },
];

/** Productivity bands, on the same fixed-edge reasoning. The bottom band is
 * wider because very low scores are rare — splitting it would leave rows
 * of two or three days. */
export const PRODUCTIVITY_BANDS: readonly Band[] = [
  { id: "lt40", label: "Under 40%", min: -Infinity, max: 40 },
  { id: "40-60", label: "40–60%", min: 40, max: 60 },
  { id: "60-80", label: "60–80%", min: 60, max: 80 },
  { id: "80+", label: "80%+", min: 80, max: Infinity },
];

// Re-exported so the Work charts keep importing day types from here; the
// definitions live in viz/day-type.ts alongside their colour.
export { DAY_TYPE_LABELS, DAY_TYPE_ORDER };

/** Lower edge inclusive, upper exclusive: exactly 8h is "8–10h". */
function bandOf(value: number, bands: readonly Band[]): number {
  return bands.findIndex((b) => value >= b.min && value < b.max);
}

/**
 * A day's location as one group key — the *combination*, not each
 * location separately.
 *
 * A split day (`{home, office}`) is its own "Home + Office" group rather
 * than a day counted once under each: crediting both would put the same
 * day's happiness in two rows and make the rows look like more independent
 * evidence than they are. Hybrid days are common enough (over a quarter
 * of logged location days when this was written) to stand as a group of
 * their own.
 */
function locationGroup(locations: WorkLocationOption[]): { id: string; label: string; order: number } {
  const sorted = [...locations].sort((a, b) => WORK_LOCATION_ORDER.indexOf(a) - WORK_LOCATION_ORDER.indexOf(b));
  const first = WORK_LOCATION_ORDER.indexOf(sorted[0]);
  return {
    id: sorted.join("+"),
    label: sorted.map((l) => WORK_LOCATION_LABELS[l]).join(" + "),
    // Singles first in slot order, then combinations after the single they
    // start with — "Home", "Office", …, then "Home + Office", "Home + Cafe".
    order: sorted.length === 1 ? first : WORK_LOCATION_ORDER.length + first * 10 + sorted.length,
  };
}

/**
 * Sorts every day with a happiness score into groups under `grouping`.
 *
 * A day that doesn't log what the grouping needs (no hours, say) is left
 * out rather than put in an "unknown" row: that row would mostly be the
 * years before hours were tracked, and its average would say something
 * about 2019, not about not working. Groups come back in their fixed
 * order, and a group no day falls into is omitted.
 */
export function groupHappiness(days: WorkDay[], grouping: HappinessGrouping): HappinessGroup[] {
  const groups = new Map<string, HappinessGroup>();
  const add = (key: { id: string; label: string; order: number }, day: WorkDay) => {
    let group = groups.get(key.id);
    if (!group) {
      group = { ...key, values: [] };
      groups.set(key.id, group);
    }
    group.values.push({ date: day.date, value: day.happiness as number });
  };

  for (const day of days) {
    if (day.happiness === null) continue;
    switch (grouping) {
      case "hours": {
        if (day.minutes === null) break;
        const i = bandOf(day.minutes / 60, HOURS_BANDS);
        add({ id: HOURS_BANDS[i].id, label: HOURS_BANDS[i].label, order: i }, day);
        break;
      }
      case "productivity": {
        if (day.productivity === null) break;
        const i = bandOf(day.productivity, PRODUCTIVITY_BANDS);
        add({ id: PRODUCTIVITY_BANDS[i].id, label: PRODUCTIVITY_BANDS[i].label, order: i }, day);
        break;
      }
      case "location":
        if (day.locations.length === 0) break;
        add(locationGroup(day.locations), day);
        break;
      case "dayType":
        if (day.dayType === null) break;
        add({ id: day.dayType, label: DAY_TYPE_LABELS[day.dayType], order: DAY_TYPE_ORDER.indexOf(day.dayType) }, day);
        break;
    }
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
