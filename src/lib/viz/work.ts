import type { CommuteCategory } from "@/lib/work";
import type { WorkLocationOption } from "@/db/schema";

/**
 * Named colours for work locations and commute modes (#444), used by the
 * Work Location Calendar's legend and cells.
 *
 * **A named-entity palette, not the categorical slots**, the same exception
 * as `SUB_COLORS` in subs.ts. The first cut used `categoricalColor` by index,
 * and home (chart-1, rust) and office (chart-2, gold) blended into an orange
 * that was hard to tell from either. The user then picked each hue for what
 * the place or mode *feels like*:
 *
 * - Location: home is cozy (honey), office is dreary (rainy-day slate),
 *   cafe is cute (kept at dark-mode chart-3's green, #0d7435), travel is
 *   red, and the rare "other" should stand out (magenta).
 * - Commute: car is asphalt, carpool is orange (the greener choice), taxi
 *   is yellow, public transit is blue, bike is green and walk is dark blue.
 *   The user didn't name "no commute" (a derived category, see
 *   `commuteCategories`) or "other"; they're a soft lavender, quiet because
 *   no-commute days are the most common, and a hot pink so the rare one
 *   stands out, matching location's "other".
 *
 * **Hex, not `var(--…)` tokens**, because `InteractiveCalendar` blends a
 * split day's colours in Lab space and d3 can't parse a CSS variable. Tuned
 * for the dark card surface, since the app is dark-only.
 *
 * **Validation record** (dataviz `validate_palette.js`, dark mode, surface
 * `#1f1611` = dark `--card`, `--pairs all`):
 *
 * - Location, all five: worst CVD pair travel↔cafe ΔE 10.3 (protan), worst
 *   normal-vision pair cafe↔office ΔE 16.7, every mark ≥ 3:1 on the card.
 *   Also checked as {home, office, home+office blend}, since the blend
 *   is what split days actually paint. A Lab midpoint sits exactly halfway,
 *   so home and office had to be at least 30 ΔE apart for the blend (#ab9576) to
 *   clear 15 from each. It lands at 18.6 normal / 17.2 protan. That's why
 *   office is a *dark* slate and home a *light* honey: lightness survives
 *   colour blindness where hue doesn't.
 * - Commute, all eight: worst CVD pair carpool↔bike ΔE 9.1 (protan), worst
 *   normal-vision pair bike↔car ΔE 16.6, every mark ≥ 3:1. Found by a
 *   constrained search that kept each colour inside its vibe's hue/
 *   lightness range and maximised the worst pair. Travel red and carpool
 *   orange sit clear of their greens on lightness for the same reason.
 * - Both fail the validator's lightness-band and chroma-floor checks by
 *   design: asphalt and slate *are* greys, lavender is pale, and taxi
 *   yellow and honey are lighter than the band. Those checks keep a generic
 *   palette even; the user asked for these colours specifically, and every
 *   separation check still passes.
 */
export const WORK_LOCATION_COLORS: Record<WorkLocationOption, string> = {
  home: "#F5C451",
  office: "#566A8E",
  cafe: "#0d7435",
  travel: "#FF6B5E",
  other: "#D946EF",
};

export const COMMUTE_COLORS: Record<CommuteCategory, string> = {
  public_transit: "#2ba1fd",
  walk: "#365bce",
  none: "#e1c2e9",
  car: "#61656b",
  bike: "#217a0b",
  taxi: "#ebcb24",
  carpool: "#f47621",
  other: "#f064ad",
};
