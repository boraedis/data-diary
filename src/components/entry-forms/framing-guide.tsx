"use client";

import { useMemo, type ReactNode, type RefObject } from "react";
import { useFramingHints } from "@/components/entry-forms/use-framing-hints";
import { portraitGuide } from "@/lib/day-portraits/guide";
import { HINT_TEXT, type FrameSize } from "@/lib/day-portraits/hints";

// What is drawn over the live portrait camera (#688, #689): the oval, the
// eye line and the centre line, plus a line of framing hints along the
// bottom. Mounted only while the camera is live and its size is known, so
// each camera session starts with a fresh set of checks.
//
// The guide turns green once the face has settled in place. The hints and
// the colour are advice: Capture is never disabled by them.

const WHITE = "white";
const GREEN = "rgb(74 222 128)";

export function FramingGuide({
  videoRef,
  frame,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  frame: FrameSize;
}) {
  // The same object across renders: it is a dependency of the checks.
  const guide = useMemo(() => portraitGuide(frame.width, frame.height), [frame]);
  const { status, hints, looksGood } = useFramingHints(videoRef, frame, guide);
  const stroke = looksGood ? GREEN : WHITE;

  let message: ReactNode;
  if (hints.length > 0) {
    message = hints.map((id) => (
      <span key={id} className="block">
        {HINT_TEXT[id]}
      </span>
    ));
  } else if (looksGood) {
    message = "Looking good. Capture when you're ready.";
  } else if (status === "loading") {
    message = "Loading framing hints…";
  } else if (status === "lighting-only") {
    message = "Face hints aren't available here, so use the guide.";
  } else {
    message = "Checking your framing…";
  }

  return (
    <>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        {/* Dim everything outside the oval so the target reads at a glance. */}
        <path
          fillRule="evenodd"
          fill="rgba(0,0,0,0.35)"
          d={`M0 0H${frame.width}V${frame.height}H0Z M${guide.cx - guide.rx} ${guide.cy} a${guide.rx} ${guide.ry} 0 1 0 ${guide.rx * 2} 0 a${guide.rx} ${guide.ry} 0 1 0 ${-guide.rx * 2} 0Z`}
        />
        <ellipse
          cx={guide.cx}
          cy={guide.cy}
          rx={guide.rx}
          ry={guide.ry}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={guide.cx - guide.rx}
          x2={guide.cx + guide.rx}
          y1={guide.eyeY}
          y2={guide.eyeY}
          stroke={stroke}
          strokeWidth={2}
          strokeDasharray="6 6"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={guide.cx}
          x2={guide.cx}
          y1={guide.cy - guide.ry}
          y2={guide.cy + guide.ry}
          stroke={stroke}
          strokeOpacity={0.5}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Overlaid at the bottom so a changing hint never moves the page. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-sm text-white"
      >
        {message}
      </div>
    </>
  );
}
