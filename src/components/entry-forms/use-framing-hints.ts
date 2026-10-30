"use client";

import { useEffect, useState, type RefObject } from "react";
import type { PortraitGuide } from "@/lib/day-portraits/guide";
import { loadFaceLandmarker } from "@/lib/day-portraits/face-landmarker";
import {
  createHintStabilizer,
  lightingHints,
  luminanceStats,
  poseHints,
  SHOW_AFTER_FRAMES,
  visibleHints,
  type FrameSize,
  type FramingHintId,
  type Landmark,
  type LuminanceStats,
} from "@/lib/day-portraits/hints";

// Runs the portrait framing checks (#689) against the live video a few
// times a second and returns the hints worth showing. The rules themselves
// are pure and tested in src/lib/day-portraits/hints.ts; this is the
// camera-facing wiring.

/** How often the checks run. Fast enough to feel live, slow enough that the
 * model and the pixel sampling cost the phone almost nothing. */
const CHECK_INTERVAL_MS = 200;
/** Width of the downscaled copy of the frame that lighting is measured on.
 * Tiny on purpose: averages don't need pixels. */
const SAMPLE_WIDTH = 64;

export type FramingState = {
  /** loading: the model is still downloading. full: face and light checks.
   * lighting-only: the model could not load, so only the light is checked. */
  status: "loading" | "full" | "lighting-only";
  hints: FramingHintId[];
  /** The face has been in the frame and nothing needs fixing. Only ever true
   * in `full`: without the model there is no way to know. */
  looksGood: boolean;
};

const INITIAL: FramingState = { status: "loading", hints: [], looksGood: false };

/** Measures the light over the guide oval's bounding box, on a small copy of
 * the frame. Null where canvas pixels can't be read (e.g. jsdom). */
function createLightSampler(frame: FrameSize, guide: PortraitGuide) {
  const width = SAMPLE_WIDTH;
  const height = Math.max(1, Math.round((SAMPLE_WIDTH * frame.height) / frame.width));
  const scale = width / frame.width;
  const box = {
    x0: (guide.cx - guide.rx) * scale,
    x1: (guide.cx + guide.rx) * scale,
    y0: (guide.cy - guide.ry) * scale,
    y1: (guide.cy + guide.ry) * scale,
  };
  let context: CanvasRenderingContext2D | null | undefined;

  return (video: HTMLVideoElement): LuminanceStats | null => {
    if (context === undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      context = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (!context) return null;
    try {
      context.drawImage(video, 0, 0, width, height);
      return luminanceStats(context.getImageData(0, 0, width, height).data, width, height, box);
    } catch {
      return null;
    }
  };
}

function sameState(a: FramingState, b: FramingState): boolean {
  return a.status === b.status && a.looksGood === b.looksGood && a.hints.join() === b.hints.join();
}

export function useFramingHints(
  videoRef: RefObject<HTMLVideoElement | null>,
  frame: FrameSize,
  guide: PortraitGuide,
): FramingState {
  const [state, setState] = useState<FramingState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stabilizer = createHintStabilizer();
    const sampleLight = createLightSampler(frame, guide);
    let faceFrames = 0;

    void loadFaceLandmarker().then((landmarker) => {
      if (cancelled) return;
      const status = landmarker ? "full" : "lighting-only";
      setState((prev) => (prev.status === status ? prev : { ...prev, status }));

      timer = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth) return;

        const raw: FramingHintId[] = [];
        let faceSeen = false;
        if (landmarker) {
          let mesh: readonly Landmark[] | undefined;
          try {
            mesh = landmarker.detectForVideo(video, performance.now()).faceLandmarks[0];
          } catch {
            // A dropped frame is not worth surfacing; the next check retries.
          }
          if (mesh) {
            faceSeen = true;
            raw.push(...poseHints(mesh, frame, guide));
          } else {
            raw.push("no-face");
          }
        }
        const light = sampleLight(video);
        if (light) raw.push(...lightingHints(light));

        const stable = stabilizer.update(raw);
        faceFrames = faceSeen ? faceFrames + 1 : 0;
        const next: FramingState = {
          status,
          hints: visibleHints(stable),
          looksGood: landmarker !== null && faceFrames >= SHOW_AFTER_FRAMES && stable.length === 0,
        };
        setState((prev) => (sameState(prev, next) ? prev : next));
      }, CHECK_INTERVAL_MS);
    });

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [videoRef, frame, guide]);

  return state;
}
