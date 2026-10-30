import type { PortraitGuide } from "@/lib/day-portraits/guide";

// Framing hints for the day portrait (#689, v2 of #622). Pure geometry and
// arithmetic over face landmarks and a few sampled pixels: no camera, no
// MediaPipe import, so every rule is testable here and the capture card only
// wires them to a live video.
//
// Hints are advisory. They never block Capture and nothing is saved because
// of one; the person always makes the final call (#689).
//
// Every threshold below is a first guess, set from the geometry of a face
// rather than from real photos, and none has been tuned against the actual
// camera and room. They are named constants so tuning is a one-line change.
//
// Deliberately not checked: looking up or down (pitch). The eye alignment
// the facelapse tool does afterwards absorbs most of it, and a landmark-only
// pitch estimate is the least trustworthy of the poses.

export type FramingHintId =
  | "no-face"
  | "too-far"
  | "too-close"
  | "off-line"
  | "off-centre"
  | "tilted"
  | "turned"
  | "too-dark"
  | "too-bright"
  | "uneven-light";

/** Most important first: what the person should fix before anything else.
 * Not seeing a face outranks everything, then how big and where the face is,
 * then its pose, then the light. */
export const HINT_PRIORITY: readonly FramingHintId[] = [
  "no-face",
  "too-far",
  "too-close",
  "off-line",
  "off-centre",
  "tilted",
  "turned",
  "too-dark",
  "too-bright",
  "uneven-light",
];

export const HINT_TEXT: Record<FramingHintId, string> = {
  "no-face": "I can't see your face. Check the light and that the camera isn't covered.",
  "too-far": "Move closer so your face fills the oval.",
  "too-close": "Move back a little so your whole face sits in the oval.",
  "off-line": "Line your eyes up with the dashed line.",
  "off-centre": "Centre your face in the oval.",
  tilted: "Level your head.",
  turned: "Face the camera straight on.",
  "too-dark": "It's too dark. Face a window or turn on a light.",
  "too-bright": "It's too bright. Move away from direct light.",
  "uneven-light": "One side of your face is lit more than the other. Face the light.",
};

/** A landmark in the frame's normalised coordinates (0 to 1 each way), which
 * is how MediaPipe returns them. */
export type Landmark = { x: number; y: number; z?: number };

/** Indices into MediaPipe's 478-point face mesh. Left and right here are
 * deliberately not named: the code orders each pair by x instead, so it
 * doesn't depend on which side of the picture the mesh calls which. */
export const LANDMARK = {
  foreheadTop: 10,
  chin: 152,
  noseTip: 1,
  eyeOuterA: 33,
  eyeOuterB: 263,
  eyeInnerA: 133,
  eyeInnerB: 362,
  faceEdgeA: 234,
  faceEdgeB: 454,
} as const;

/** How tall the face (hairline landmark to chin) should be, as a share of
 * the guide oval's height. The oval also holds hair and some neck, so a
 * well-framed face is most, not all, of it. */
export const TARGET_FACE_SHARE_OF_OVAL = 0.85;
/** Below this share of the oval, the person is too far away; above the
 * second, too close. */
export const MIN_FACE_SHARE_OF_OVAL = 0.68;
export const MAX_FACE_SHARE_OF_OVAL = 1.08;
/** Eyes may sit this far from the eye line before it is flagged, as a share
 * of the oval's vertical radius. */
export const MAX_EYE_LINE_OFFSET = 0.15;
/** The eyes' midpoint may sit this far from the oval's centre line, as a
 * share of the oval's horizontal radius. */
export const MAX_CENTRE_OFFSET = 0.25;
/** Degrees the line through the eyes may tilt from level. */
export const MAX_ROLL_DEGREES = 4;
/** How far the nose may sit from the middle of the face's width, as a share
 * of that width, before the head counts as turned. */
export const MAX_NOSE_OFFSET = 0.08;

export type FrameSize = { width: number; height: number };

function toPixels(point: Landmark, frame: FrameSize): { x: number; y: number } {
  return { x: point.x * frame.width, y: point.y * frame.height };
}

/**
 * Which pose and position hints a face needs right now.
 *
 * Maths runs in pixels, not normalised units: a frame is wider than it is
 * tall, so a tilt measured in 0-to-1 coordinates would be off by the aspect
 * ratio. `landmarks` is one face's mesh; `guide` is the same guide the card
 * draws, in the frame's pixel space.
 */
export function poseHints(landmarks: readonly Landmark[], frame: FrameSize, guide: PortraitGuide): FramingHintId[] {
  const get = (index: number) => toPixels(landmarks[index], frame);
  const top = get(LANDMARK.foreheadTop);
  const chin = get(LANDMARK.chin);
  const nose = get(LANDMARK.noseTip);
  const eyeA = get(LANDMARK.eyeOuterA);
  const eyeB = get(LANDMARK.eyeOuterB);
  const innerA = get(LANDMARK.eyeInnerA);
  const innerB = get(LANDMARK.eyeInnerB);
  const edgeA = get(LANDMARK.faceEdgeA);
  const edgeB = get(LANDMARK.faceEdgeB);

  const hints: FramingHintId[] = [];

  // Distance: the face's height against the oval's.
  const faceHeight = Math.hypot(chin.x - top.x, chin.y - top.y);
  const share = faceHeight / (guide.ry * 2);
  if (share < MIN_FACE_SHARE_OF_OVAL) hints.push("too-far");
  else if (share > MAX_FACE_SHARE_OF_OVAL) hints.push("too-close");

  // Position: where the eyes are against the eye line and the centre line.
  const eyeMidX = (eyeA.x + eyeB.x + innerA.x + innerB.x) / 4;
  const eyeMidY = (eyeA.y + eyeB.y + innerA.y + innerB.y) / 4;
  if (Math.abs(eyeMidY - guide.eyeY) / guide.ry > MAX_EYE_LINE_OFFSET) hints.push("off-line");
  if (Math.abs(eyeMidX - guide.cx) / guide.rx > MAX_CENTRE_OFFSET) hints.push("off-centre");

  // Roll: the slope of the line through the outer eye corners, ordered by x
  // so the angle is the small signed tilt, never near 180.
  const [leftEye, rightEye] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];
  const roll = (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI;
  if (Math.abs(roll) > MAX_ROLL_DEGREES) hints.push("tilted");

  // Yaw: how far the nose sits from the middle of the face's width.
  const leftEdge = Math.min(edgeA.x, edgeB.x);
  const rightEdge = Math.max(edgeA.x, edgeB.x);
  const width = rightEdge - leftEdge;
  if (width > 0 && Math.abs((nose.x - leftEdge) / width - 0.5) > MAX_NOSE_OFFSET) hints.push("turned");

  return hints;
}

// --- Lighting ---------------------------------------------------------------

export type LuminanceStats = {
  /** Mean luma, 0 to 255, over the sampled box. */
  mean: number;
  /** Mean luma of the box's left and right halves. */
  leftMean: number;
  rightMean: number;
  /** Share of pixels at or near white (0 to 1): the blown-out highlights. */
  clippedShare: number;
};

export const MIN_MEAN_LUMA = 60;
export const MAX_MEAN_LUMA = 200;
/** A pixel at or above this luma counts as clipped. */
export const CLIPPED_LUMA = 250;
export const MAX_CLIPPED_SHARE = 0.15;
/** Largest tolerated gap between the halves, as a share of the brighter
 * one. */
export const MAX_SIDE_LIGHT_GAP = 0.35;

export type SampleBox = { x0: number; y0: number; x1: number; y1: number };

/**
 * Luma statistics over a box of an RGBA pixel buffer (what a canvas's
 * `getImageData` returns). Rec. 709 weights. Returns null for an empty box.
 */
export function luminanceStats(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  box: SampleBox,
): LuminanceStats | null {
  const x0 = Math.max(0, Math.floor(box.x0));
  const y0 = Math.max(0, Math.floor(box.y0));
  const x1 = Math.min(width, Math.ceil(box.x1));
  const y1 = Math.min(height, Math.ceil(box.y1));
  if (x1 <= x0 || y1 <= y0) return null;

  const midX = (x0 + x1) / 2;
  let total = 0;
  let count = 0;
  let leftTotal = 0;
  let leftCount = 0;
  let rightTotal = 0;
  let rightCount = 0;
  let clipped = 0;

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const luma = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
      total += luma;
      count++;
      if (luma >= CLIPPED_LUMA) clipped++;
      if (x + 0.5 < midX) {
        leftTotal += luma;
        leftCount++;
      } else {
        rightTotal += luma;
        rightCount++;
      }
    }
  }

  return {
    mean: total / count,
    leftMean: leftCount ? leftTotal / leftCount : total / count,
    rightMean: rightCount ? rightTotal / rightCount : total / count,
    clippedShare: clipped / count,
  };
}

export function lightingHints(stats: LuminanceStats): FramingHintId[] {
  const hints: FramingHintId[] = [];
  if (stats.mean < MIN_MEAN_LUMA) hints.push("too-dark");
  else if (stats.mean > MAX_MEAN_LUMA || stats.clippedShare > MAX_CLIPPED_SHARE) hints.push("too-bright");
  // Side light only matters when it isn't already too dark or bright: a
  // dark room has a large relative gap between two near-black halves.
  else {
    const brighter = Math.max(stats.leftMean, stats.rightMean);
    if (brighter > 0 && Math.abs(stats.leftMean - stats.rightMean) / brighter > MAX_SIDE_LIGHT_GAP) {
      hints.push("uneven-light");
    }
  }
  return hints;
}

// --- Steadying --------------------------------------------------------------

/** Frames a condition must hold before its hint appears. At about five
 * checks a second this is under a second: long enough to ignore a blink or
 * one jittery frame. */
export const SHOW_AFTER_FRAMES = 4;
/** Frames a condition must stay gone before its hint clears. Shorter than
 * showing, so a fix feels acknowledged quickly. */
export const CLEAR_AFTER_FRAMES = 3;
/** The most hints shown at once. More than two is a lecture. */
export const MAX_SHOWN_HINTS = 2;

export type HintStabilizer = {
  /** Feed one check's raw hints; get back the hints now worth showing, most
   * important first. */
  update(raw: readonly FramingHintId[]): FramingHintId[];
  reset(): void;
};

/**
 * Debounces raw per-frame hints so the line under the preview doesn't
 * flicker. A hint appears once it has been present `showAfter` checks in a
 * row, and goes once it has been absent `clearAfter` in a row.
 */
export function createHintStabilizer(
  showAfter: number = SHOW_AFTER_FRAMES,
  clearAfter: number = CLEAR_AFTER_FRAMES,
): HintStabilizer {
  const present = new Map<FramingHintId, number>();
  const absent = new Map<FramingHintId, number>();
  const shown = new Set<FramingHintId>();

  return {
    update(raw) {
      const now = new Set(raw);
      for (const id of HINT_PRIORITY) {
        if (now.has(id)) {
          present.set(id, (present.get(id) ?? 0) + 1);
          absent.set(id, 0);
          if ((present.get(id) ?? 0) >= showAfter) shown.add(id);
        } else {
          absent.set(id, (absent.get(id) ?? 0) + 1);
          present.set(id, 0);
          if ((absent.get(id) ?? 0) >= clearAfter) shown.delete(id);
        }
      }
      return HINT_PRIORITY.filter((id) => shown.has(id));
    },
    reset() {
      present.clear();
      absent.clear();
      shown.clear();
    },
  };
}

const LIGHTING_HINTS: readonly FramingHintId[] = ["too-dark", "too-bright", "uneven-light"];

/** The hints to put on screen: the most important few. When the face can't
 * be seen, pose and position mean nothing, so only the light can join that
 * hint: a dark room is the likeliest reason no face was found. */
export function visibleHints(stable: readonly FramingHintId[]): FramingHintId[] {
  if (stable.includes("no-face")) {
    const withLight: FramingHintId[] = ["no-face", ...stable.filter((id) => LIGHTING_HINTS.includes(id))];
    return withLight.slice(0, MAX_SHOWN_HINTS);
  }
  return stable.slice(0, MAX_SHOWN_HINTS);
}
