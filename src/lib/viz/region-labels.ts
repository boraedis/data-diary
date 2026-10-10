// When a map region is big enough on screen to carry its own name (the
// labels InteractiveGeo draws on its polygons). Pure arithmetic on a
// polygon's projected size, so it can be tested without a DOM, same split
// as timeline.ts / line-labels.ts.
//
// Labels are a constant size on screen (the font is divided by the zoom's
// scale, like the markers), so whether one fits depends on the zoom `k`
// alone: the polygon's projected size grows with k while the text doesn't.
// That makes the answer a threshold, `labelMinZoom`, worked out once per
// polygon at draw time. A zoom tick then only compares k against it, which
// matters for a map with a thousand labels (Istanbul's mahalles).

/** On-screen label size in px. Matches the marker annotations. */
export const REGION_LABEL_FONT_PX = 11;

// Average advance of the semi-bold sans these labels use, as a fraction of
// the font size. Deliberately on the generous side: a label that is shown
// should never spill over its polygon's edge, and one that is hidden a
// little early reappears a zoom step later.
const AVG_CHAR_WIDTH_EM = 0.6;

/** Padding, in px, kept clear between the text and the polygon's bounding
 * box on each axis. */
const FIT_PADDING_PX = 8;

export type RegionBox = {
  /** Projected bounding-box size at zoom 1, in px. */
  width: number;
  height: number;
  /** Projected polygon area at zoom 1, in px². */
  area: number;
};

/** Estimated width of `text` on screen, in px. */
export function labelWidthPx(text: string, fontPx: number = REGION_LABEL_FONT_PX): number {
  return text.length * fontPx * AVG_CHAR_WIDTH_EM;
}

/**
 * The smallest zoom scale at which `text` fits inside a polygon, or
 * Infinity when the polygon is degenerate.
 *
 * Three tests, all of which must pass. The bounding box has to be wide
 * and tall enough for the text; and the polygon's *area* has to be a
 * decent multiple of the text's, which catches the long diagonal sliver
 * whose bounding box is generous but whose body can't hold a word.
 */
export function labelMinZoom(text: string, box: RegionBox, fontPx: number = REGION_LABEL_FONT_PX): number {
  if (!(box.width > 0) || !(box.height > 0) || !(box.area > 0)) return Infinity;
  const textWidth = labelWidthPx(text, fontPx);
  const needWidth = (textWidth + FIT_PADDING_PX) / box.width;
  const needHeight = (fontPx * 1.6) / box.height;
  const needArea = Math.sqrt((textWidth * fontPx * 2.5) / box.area);
  return Math.max(needWidth, needHeight, needArea);
}
