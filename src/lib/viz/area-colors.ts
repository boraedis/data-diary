/**
 * Colours for the Centre of Gravity chart's top ten areas (#215), by
 * all-time rank — rank 0 is the area with the most days. Areas ranked
 * eleventh and below share `AREA_OVERFLOW_COLOR`.
 *
 * **A chart-specific exception to `categoricalColor`'s five slots**, the
 * same kind the Subs palette is (src/lib/viz/subs.ts). The owner asked for
 * ten coloured areas rather than five (2026-09-30), after being shown that
 * ten colours usually can't be told apart; it's recorded here so the next
 * reader knows it was a decision, not an oversight.
 *
 * **Why these ten.** A map is the hardest case for a categorical palette:
 * any two circles can end up side by side, so every *pair* has to separate,
 * not just neighbours in a legend order. Evenly spaced hues failed badly
 * (worst colour-blind pair ΔE 2.1). These came from a hill-climb in OKLCH
 * over the validator's own all-pairs score, holding every colour to the
 * dark lightness band and chroma floor, and keeping clear of hues 22–62°,
 * where the trail's terracotta time ramp sits, so no circle reads as part
 * of the line.
 *
 * **Validation record** (dataviz `validate_palette.js`, dark mode, surface
 * `#1f1611` = dark `--card`, `--pairs all`): lightness band, chroma floor
 * and normal-vision floor pass (worst pair #ab60c9↔#663dc6 ΔE 15.3); CVD
 * separation WARNs at the floor (worst #32864a↔#815300 ΔE 8.0 deutan,
 * tritan 4.0); four colours (#815300, #006595, #663dc6, #a81e72, ranks 7–10)
 * are under 3:1 against the card. Both warnings require secondary
 * encoding, which the chart provides: every top-ten circle carries its
 * name on the map, the legend names all ten, and every tooltip and the
 * breakdown panel name each area beside its swatch. The four low-contrast
 * colours are deliberately the last four ranks, so the areas that matter
 * most get the strongest colours.
 *
 * Hex rather than `var(--…)` tokens, like the Subs palette: the app is
 * dark-only (`dark` is hardcoded on `<html>`), and these were validated
 * against the dark card only. A light theme would need its own steps.
 */
export const AREA_COLORS = [
  "#ed4b7c",
  "#00a9b1",
  "#298aff",
  "#b2900f",
  "#32864a",
  "#ab60c9",
  "#815300",
  "#006595",
  "#663dc6",
  "#a81e72",
] as const;

/** Every area past the tenth. Muted, so the long tail of one-off trips
 * recedes behind the areas that shaped the line. */
export const AREA_OVERFLOW_COLOR = "var(--muted-foreground)";

/** An area's colour from its all-time rank (0-based). */
export function areaColorForRank(rank: number): string {
  return AREA_COLORS[rank] ?? AREA_OVERFLOW_COLOR;
}
