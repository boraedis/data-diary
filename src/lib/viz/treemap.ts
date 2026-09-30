// Pure geometry for InteractiveTreemap (#213): which label a tile can
// carry, and how much of a group's box its header takes. Split out of the
// component the same way `timeline.ts` is from InteractiveTimeline, so the
// rules are testable without a DOM.
//
// The label strategy deliberately follows InteractiveDonut's rather than
// inventing a second one (#213 asked for exactly that): a fixed ladder of
// font-size tiers, tried largest first against the *measured geometry* of
// the mark, with a two-line wrap and then `shortName` as the fallbacks,
// and no label at all when nothing fits. The difference is only the shape
// being fitted — a rectangle whose text runs horizontally, where the
// donut fits text radially along a ring.

/** A laid-out tile's pixel box — the subset of a d3 `HierarchyRectangularNode`
 * the fitting rules read. */
export type TileBox = { x0: number; y0: number; x1: number; y1: number };

/** Font-size tiers, largest first. Floors at 10px rather than the donut's
 * 8px: a treemap's small tiles are small in *both* directions, so an 8px
 * label that technically fits is sitting in a tile too small to read it
 * from anyway, where a thin arc can still be long. */
export const TILE_FONT_TIERS = [14, 12, 10] as const;
/** Same estimate InteractiveDonut uses, for the same reason: measuring
 * every label's real advance width means a forced layout per tile, and
 * the cost of being slightly wrong is only a label hidden a little early. */
const AVG_GLYPH_WIDTH_RATIO = 0.55;
/** Line box as a multiple of font size. Tighter than the donut's 1.45:
 * there, two labels on neighbouring hairline arcs could touch; here every
 * tile is its own box with a surface gap around it. */
const LINE_HEIGHT_RATIO = 1.2;
/** Inset from each tile edge before text starts. */
export const TILE_LABEL_PADDING = 4;

/** Height of a group's header band, in px — room for one line at the
 * axis tick size (`MARK_SPECS.axis.tickFontSize`) plus breathing room. */
export const GROUP_HEADER_HEIGHT = 18;
export const GROUP_HEADER_FONT_SIZE = 11;
/** A group narrower than this, or shorter than a header plus this much
 * body, gets no header: its band would either hold no readable text or
 * eat most of the space its children need. The tooltip and breadcrumb
 * still name it. */
const MIN_HEADER_WIDTH = 48;
const MIN_BODY_UNDER_HEADER = 2 * GROUP_HEADER_HEIGHT;

function fits(box: TileBox, longestLine: number, lineCount: number, size: number): boolean {
  const width = box.x1 - box.x0 - 2 * TILE_LABEL_PADDING;
  const height = box.y1 - box.y0 - 2 * TILE_LABEL_PADDING;
  return longestLine * size * AVG_GLYPH_WIDTH_RATIO <= width && lineCount * size * LINE_HEIGHT_RATIO <= height;
}

/** Splits at the space nearest the middle, or `null` when there's no
 * space to split on. Same rule as InteractiveDonut's `splitIntoTwoLines`
 * — a single long word isn't hyphenated, it falls through to `shortName`. */
function splitIntoTwoLines(text: string): [string, string] | null {
  const spaces: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === " ") spaces.push(i);
  if (spaces.length === 0) return null;
  const middle = text.length / 2;
  const at = spaces.reduce((best, i) => (Math.abs(i - middle) < Math.abs(best - middle) ? i : best), spaces[0]);
  const head = text.slice(0, at).trim();
  const tail = text.slice(at + 1).trim();
  return head && tail ? [head, tail] : null;
}

export type TileLabel = {
  /** The name, on one line or wrapped across two. */
  lines: string[];
  size: number;
  /** The formatted value, as one more line under the name — only when
   * there's room for it at the same size. Omitted rather than shrunk: a
   * value in smaller type than its name reads as a footnote. */
  value?: string;
};

/**
 * The best label a tile can show, or `null` for none.
 *
 * Candidates, in order: the full name on one line, the full name wrapped
 * across two, then `shortName` (the consumer's abbreviation — initials,
 * for people, which is what legacy's `people_treemap` drew). Bigger type
 * wins between the one- and two-line forms of the same text; the full
 * name always beats the short one, even at a smaller size — the donut's
 * rule, for the donut's reason: an abbreviation the reader has to decode
 * is a worse trade than smaller type. The tooltip and breadcrumb always
 * carry the full name either way.
 */
export function resolveTileLabel(
  box: TileBox,
  name: string,
  shortName?: string,
  valueText?: string,
): TileLabel | null {
  const candidates = shortName && shortName !== name ? [name, shortName] : [name];
  for (const text of candidates) {
    for (const size of TILE_FONT_TIERS) {
      let lines: string[] | null = null;
      if (fits(box, text.length, 1, size)) lines = [text];
      else {
        const wrapped = splitIntoTwoLines(text);
        if (wrapped && fits(box, Math.max(wrapped[0].length, wrapped[1].length), 2, size)) lines = wrapped;
      }
      if (!lines) continue;
      const longest = Math.max(...lines.map((line) => line.length));
      const withValue =
        valueText !== undefined &&
        fits(box, Math.max(longest, valueText.length), lines.length + 1, size);
      return withValue ? { lines, size, value: valueText } : { lines, size };
    }
  }
  return null;
}

/**
 * Header band height for a group node — `GROUP_HEADER_HEIGHT`, or 0 when
 * the group is too small to spend space on one. Fed to d3's
 * `treemap.paddingTop`, which is called on each parent *after* its own
 * box is set and before its children are tiled, so a header can depend on
 * the group's real size.
 *
 * The root (the focused node) never gets one: the breadcrumb above the
 * chart already names it.
 */
export function groupHeaderHeight(box: TileBox, depth: number): number {
  if (depth === 0) return 0;
  const width = box.x1 - box.x0;
  const height = box.y1 - box.y0;
  return width >= MIN_HEADER_WIDTH && height >= GROUP_HEADER_HEIGHT + MIN_BODY_UNDER_HEADER
    ? GROUP_HEADER_HEIGHT
    : 0;
}

/**
 * The header text for a group of the given width, or `null` for none.
 *
 * Unlike a tile label, a header is allowed to truncate with an ellipsis
 * before giving up: it's a single line in a strip whose job is to say
 * *which* group this is, and "Univers…" still does that where hiding it
 * wouldn't. `shortName` is tried first when the full name doesn't fit,
 * for the same reason the tile rule prefers it to nothing.
 */
export function resolveHeaderLabel(width: number, name: string, shortName?: string): string | null {
  const room = Math.floor((width - 2 * TILE_LABEL_PADDING) / (GROUP_HEADER_FONT_SIZE * AVG_GLYPH_WIDTH_RATIO));
  if (name.length <= room) return name;
  if (shortName && shortName.length <= room) return shortName;
  // Four characters plus the ellipsis is the least that still names
  // something; below that it's noise.
  return room >= 5 ? `${name.slice(0, room - 1).trimEnd()}…` : null;
}
