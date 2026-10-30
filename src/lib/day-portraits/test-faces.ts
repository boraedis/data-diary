import { portraitGuide } from "@/lib/day-portraits/guide";
import { LANDMARK, TARGET_FACE_SHARE_OF_OVAL, type Landmark } from "@/lib/day-portraits/hints";

// Synthetic faces for tests of the framing hints (#689). Not imported by
// app code.

export const FRAME = { width: 1920, height: 1080 };
export const GUIDE = portraitGuide(FRAME.width, FRAME.height);

/** A synthetic face in pixel terms, converted to the normalised landmarks
 * MediaPipe returns. Defaults to a well-framed one: eyes on the eye line,
 * centred, level, nose in the middle, face most of the oval's height. */
export function face(
  options: {
    share?: number;
    dx?: number;
    dy?: number;
    rollDegrees?: number;
    noseShift?: number;
    mirrored?: boolean;
  } = {},
): Landmark[] {
  const { share = TARGET_FACE_SHARE_OF_OVAL, dx = 0, dy = 0, rollDegrees = 0, noseShift = 0, mirrored = false } = options;
  const faceHeight = share * GUIDE.ry * 2;
  const faceWidth = faceHeight * 0.75;
  const eyeX = GUIDE.cx + dx;
  const eyeY = GUIDE.eyeY + dy;
  const roll = (rollDegrees * Math.PI) / 180;
  // An eye corner `along` pixels from the eyes' midpoint, tilted by the roll.
  const eye = (along: number) => ({ x: eyeX + along * Math.cos(roll), y: eyeY + along * Math.sin(roll) });
  const side = mirrored ? -1 : 1;

  const points: Record<number, { x: number; y: number }> = {
    [LANDMARK.foreheadTop]: { x: eyeX, y: eyeY - faceHeight * 0.38 },
    [LANDMARK.chin]: { x: eyeX, y: eyeY - faceHeight * 0.38 + faceHeight },
    [LANDMARK.noseTip]: { x: eyeX + noseShift * faceWidth, y: eyeY + faceHeight * 0.2 },
    [LANDMARK.eyeOuterA]: eye(-faceWidth * 0.3 * side),
    [LANDMARK.eyeOuterB]: eye(faceWidth * 0.3 * side),
    [LANDMARK.eyeInnerA]: eye(-faceWidth * 0.1 * side),
    [LANDMARK.eyeInnerB]: eye(faceWidth * 0.1 * side),
    [LANDMARK.faceEdgeA]: { x: eyeX - (faceWidth / 2) * side, y: eyeY + faceHeight * 0.1 },
    [LANDMARK.faceEdgeB]: { x: eyeX + (faceWidth / 2) * side, y: eyeY + faceHeight * 0.1 },
  };
  const landmarks: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [index, p] of Object.entries(points)) {
    landmarks[Number(index)] = { x: p.x / FRAME.width, y: p.y / FRAME.height, z: 0 };
  }
  return landmarks;
}

