// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { FramingGuide } from "./framing-guide";
import { face, FRAME } from "@/lib/day-portraits/test-faces";
import type { Landmark } from "@/lib/day-portraits/hints";

// #689: the live framing hints. The rules are tested as pure functions in
// hints.test.ts; this covers the wiring from a (fake) landmarker, through
// the steadying, to the words on screen. jsdom has no real camera and no
// canvas pixels, so lighting is not exercised here.

const loadFaceLandmarker = vi.fn();
vi.mock("@/lib/day-portraits/face-landmarker", () => ({
  loadFaceLandmarker: () => loadFaceLandmarker(),
}));

function fakeLandmarker(next: () => Landmark[] | undefined) {
  return {
    detectForVideo: () => {
      const mesh = next();
      return { faceLandmarks: mesh ? [mesh] : [] };
    },
  };
}

/** A <video> that looks ready to the hook: has a size and enough data. */
function readyVideo() {
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", { value: 4 });
  Object.defineProperty(video, "videoWidth", { value: FRAME.width });
  Object.defineProperty(video, "videoHeight", { value: FRAME.height });
  return { current: video };
}

/** Lets the landmarker finish loading, then runs `checks` timer ticks. */
async function run(checks: number) {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200 * checks);
  });
}

describe("FramingGuide", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadFaceLandmarker.mockReset();
    // jsdom has no canvas; say so quietly instead of logging "not implemented".
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("says it is loading until the model arrives", () => {
    loadFaceLandmarker.mockReturnValue(new Promise(() => {}));
    render(<FramingGuide videoRef={readyVideo()} frame={FRAME} />);
    expect(screen.getByRole("status").textContent).toBe("Loading framing hints…");
  });

  it("tells you to level your head once a tilt has held, not on the first frame", async () => {
    loadFaceLandmarker.mockResolvedValue(fakeLandmarker(() => face({ rollDegrees: 9 })));
    render(<FramingGuide videoRef={readyVideo()} frame={FRAME} />);

    await run(2);
    expect(screen.getByRole("status").textContent).not.toContain("Level your head.");

    await run(3);
    expect(screen.getByRole("status").textContent).toContain("Level your head.");
  });

  it("clears the hint and turns the guide green once the face settles", async () => {
    let mesh: Landmark[] | undefined = face({ rollDegrees: 9 });
    loadFaceLandmarker.mockResolvedValue(fakeLandmarker(() => mesh));
    const { container } = render(<FramingGuide videoRef={readyVideo()} frame={FRAME} />);
    await run(6);
    expect(screen.getByRole("status").textContent).toContain("Level your head.");
    expect(container.querySelector("ellipse")?.getAttribute("stroke")).toBe("white");

    mesh = face();
    await run(8);

    expect(screen.getByRole("status").textContent).toBe("Looking good. Capture when you're ready.");
    expect(container.querySelector("ellipse")?.getAttribute("stroke")).toBe("rgb(74 222 128)");
  });

  it("says when it cannot see a face", async () => {
    loadFaceLandmarker.mockResolvedValue(fakeLandmarker(() => undefined));
    render(<FramingGuide videoRef={readyVideo()} frame={FRAME} />);
    await run(6);
    expect(screen.getByRole("status").textContent).toContain("I can't see your face.");
  });

  it("falls back to the plain guide when the model cannot load", async () => {
    loadFaceLandmarker.mockResolvedValue(null);
    render(<FramingGuide videoRef={readyVideo()} frame={FRAME} />);
    await run(6);
    expect(screen.getByRole("status").textContent).toBe("Face hints aren't available here, so use the guide.");
  });

  it("stops checking when it goes away", async () => {
    const detect = vi.fn(() => ({ faceLandmarks: [face()] }));
    loadFaceLandmarker.mockResolvedValue({ detectForVideo: detect });
    const { unmount } = render(<FramingGuide videoRef={readyVideo()} frame={FRAME} />);
    await run(3);
    const calls = detect.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(detect.mock.calls.length).toBe(calls);
  });
});
