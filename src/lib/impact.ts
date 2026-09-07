/**
 * Legacy's people-impact score, ported verbatim from
 * `functions/views/vis/vis_functions.js:690-703`.
 *
 * Scores how much a person present on a day counts, from that day's
 * happiness and which slot they occupied. Kept identical to legacy on
 * purpose (decided on #232): the numbers have years of remembered meaning
 * behind them, and a chart that quietly disagreed with that history would
 * be worse than one carrying forward a formula nobody would derive today.
 *
 * **Do not "fix" the shape of `positiveWeight` below.** It is not
 * monotonic, and that is the original behaviour rather than a transcription
 * error — see its own comment. `impact.test.ts` pins the curve precisely so
 * an intuitive-looking correction fails loudly instead of silently
 * rewriting history.
 *
 * The derivation of the constants isn't recorded anywhere, in legacy or
 * here. What's known is what they do, which is documented; why these exact
 * numbers is not recoverable.
 */

/**
 * Per-slot multipliers, positive slots 1-7.
 *
 * Earlier slots count for slightly more — the day form's slot order carries
 * a soft ranking, and this is what reads it.
 */
const POSITIVE_SLOT_WEIGHTS = [1.15, 1.1, 1.06, 1.02, 1, 0.98, 0.96];

/** Per-slot multipliers for the negative slots, indexed 0, -1, -2. */
const NEGATIVE_SLOT_WEIGHTS = [1.2, 1, 0.8];

/** Legacy's scale factor. No recorded derivation; it sets the units the
 * remembered numbers are in, so it stays. */
const SCALE = 12;

/**
 * The positive-slot happiness curve, over a 0-1 happiness fraction.
 *
 * **Deliberately not monotonic.** It bottoms out near h = 0.8 (≈0.05) and
 * rises in both directions — roughly 0.56 at h = 0 and 0.23 at h = 1.0. So
 * a person present on a very bad day scores higher than one present on a
 * merely good day, and the minimum sits at "quite good but not great".
 *
 * That reads as surprising and was explicitly confirmed as intended rather
 * than corrected (#232). One reading is that presence counts most when a
 * day is either its best or its hardest, and least when nothing much was
 * happening — but that's an interpretation, not something legacy recorded.
 *
 * `(1.5 - h)` is a pole the 0-1 input never reaches, though the curve
 * steepens sharply as h approaches 1.
 */
function positiveWeight(h: number): number {
  return (h + 1.2) * ((h - 0.8) ** 2 / (1.5 - h)) + 0.05;
}

/** The negative-slot curve. Monotonic, and negative below h = 0.5. */
function negativeWeight(h: number): number {
  return -(2 ** (-2 * h)) + 0.25;
}

/**
 * A person's impact on one day.
 *
 * @param happiness the day's score, 0-100 (legacy divides by 100 here, so
 *   callers pass the raw stored value)
 * @param slot 1-7 for the positive slots; 0, -1 or -2 for the negative ones
 */
export function personImpact(happiness: number, slot: number): number {
  if (slot > 0) {
    const weight = POSITIVE_SLOT_WEIGHTS[slot - 1];
    if (weight === undefined) return 0;
    return weight * positiveWeight(happiness / 100) * SCALE;
  }
  const weight = NEGATIVE_SLOT_WEIGHTS[-slot];
  if (weight === undefined) return 0;
  return weight * negativeWeight(happiness / 100) * SCALE;
}
