import { SUB_NAMES } from "@/lib/days";

export type SubName = (typeof SUB_NAMES)[number];

/**
 * Each sub's own fixed colour, shared by every subs chart (#120) — Daily
 * Subs, Subs Trend and the Subs Calendar all read from this one map, so a
 * sub is the same colour wherever it's drawn.
 *
 * **A named-entity palette, not the categorical slots.** Nine subs overflow
 * `categoricalColor`'s five slots, and the hues here are chosen by the user
 * for what each sub *is* (A beer-gold, W cannabis green, C snow white, L
 * psychedelic purple, Ni tobacco brown, NO metallic grey; D and Ad just
 * "different from the rest"; K a second white, told apart from C) rather
 * than assigned by index. Same kind of named exception as
 * `--metric-weight`/the Instagram colours in technology-charts.tsx.
 *
 * **Hex, not `var(--…)` tokens**, because the Subs Calendar blends these in
 * Lab space (`InteractiveCalendar`'s `categories`), and d3 can't parse a
 * CSS variable. The app is dark-only (`dark` is hardcoded on `<html>` in
 * layout.tsx), so these are tuned for the dark card surface; C and K would
 * need darker light-mode variants if a light theme ever ships.
 *
 * **Validation record** (dataviz `validate_palette.js`, dark mode, surface
 * `#1f1611` = dark `--card`, `--pairs all`):
 *
 * - The default-on trio, A/W/Ni, passes CVD and normal-vision separation
 *   outright as a set (worst pair W↔Ni: ΔE 8.7 deutan / 19.5 normal). A
 *   and W started out as a yellow and a green that were near-identical to
 *   a protanope (ΔE 1.8); A was lightened and W darkened until the pair
 *   separated on lightness, which red-green colour blindness doesn't erase.
 * - All nine together: every mark clears 3:1 contrast against the card;
 *   worst CVD pair D↔L ΔE 7.3 deutan (the 6–8 "legal with secondary
 *   encoding" band); worst normal-vision pair D↔Ad ΔE 12.6. The lightness
 *   and chroma-floor checks fail for C, K, NO and Ni by design — white,
 *   grey and brown *are* low-chroma, off-band colours, and the user asked
 *   for exactly those. A search over the space with those semantic anchors
 *   fixed topped out at ~7 ΔE worst-pair, so this is about as separable as
 *   nine colours with two whites and a grey get.
 *
 * The secondary encoding that makes the weaker pairs acceptable: every
 * chart names each sub in its legend and tooltip rows, and the six rare
 * subs start toggled off (see `DEFAULT_VISIBLE_SUBS`), so the weaker pairs
 * only share a plot when a reader deliberately turns both on.
 */
export const SUB_COLORS: Record<SubName, string> = {
  A: "#F2B33D",
  W: "#3C9A3C",
  C: "#E4F3FF",
  L: "#A64DE8",
  Ni: "#8C5C35",
  NO: "#8F969C",
  Ad: "#127A9E",
  D: "#0A9CE0",
  K: "#D2BFC8",
};

/**
 * The subs the line charts open with visible; the rest start toggled off in
 * the legend.
 *
 * The same three the recap reports on (`RECAP_SUB_NAMES` in
 * `src/lib/recap-subs.ts`) and for the same reason: they're the ones with
 * real signal. The other six have each been above zero on a handful of
 * days in the entire history, so drawing them by default adds six lines
 * lying flat along zero. Not imported from there because that module
 * pulls in the database layer, and this one is read by client components.
 */
export const DEFAULT_VISIBLE_SUBS: readonly SubName[] = ["A", "W", "Ni"];

/** Legend ids to start hidden, in the shape `InteractiveLine`/
 * `InteractiveScroller`'s `initialHiddenIds` takes. */
export const DEFAULT_HIDDEN_SUBS: readonly SubName[] = SUB_NAMES.filter(
  (name) => !DEFAULT_VISIBLE_SUBS.includes(name),
);
