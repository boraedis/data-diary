// The framing guide drawn over the live camera for a day portrait
// (#622, #688): a face-shaped oval, a horizontal eye line and a vertical
// centre line. Pure geometry, in the pixel space of the frame it is drawn
// over, so the same numbers are testable here and drawn by the capture card.
//
// v1 is a fixed overlay on purpose: no face detection (see #622). The
// facelapse tool does the real eye alignment afterwards; the guide's job is
// only to make every day's distance, centring and head height roughly the
// same so there's less for that step to correct.

export type PortraitGuide = {
  /** Oval centre. */
  cx: number;
  cy: number;
  /** Oval radii. */
  rx: number;
  ry: number;
  /** y of the eye line, where the eyes should sit. */
  eyeY: number;
};

/** The oval's height as a share of the frame height. Leaves room for hair
 * above and the chin and neck below. */
export const GUIDE_HEIGHT_SHARE = 0.7;
/** A face is taller than wide; width/height of the oval. */
export const GUIDE_ASPECT = 0.78;
/** Share of the frame height the oval's centre sits down from the top.
 * Slightly above the middle: people frame themselves a little high. */
export const GUIDE_CENTER_Y = 0.47;
/** Eyes sit about halfway down a head, a touch above the oval's centre.
 * Where the eye line lands, as a fraction of the vertical radius above the
 * oval's centre. A starting value to tune against real photos. */
export const GUIDE_EYE_OFFSET = 0.1;

export function portraitGuide(width: number, height: number): PortraitGuide {
  const ry = (height * GUIDE_HEIGHT_SHARE) / 2;
  // Never wider than the frame allows, which matters on a narrow phone
  // viewport shown in portrait.
  const rx = Math.min(ry * GUIDE_ASPECT, (width * 0.9) / 2);
  const cx = width / 2;
  const cy = height * GUIDE_CENTER_Y;
  return { cx, cy, rx, ry, eyeY: cy - ry * GUIDE_EYE_OFFSET };
}
