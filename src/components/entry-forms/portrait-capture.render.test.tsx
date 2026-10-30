// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PortraitCapture } from "./portrait-capture";
import type { DayPortrait } from "@/lib/day-portraits/rules";

// #688: the day portrait card. jsdom covers the wiring and the states a
// person moves through (empty, saved, camera refused, camera live, cancel).
// The framing overlay's real look and a real camera are not exercised here.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// The framing hints load a real model; here they simply aren't available.
vi.mock("@/lib/day-portraits/face-landmarker", () => ({ loadFaceLandmarker: () => Promise.resolve(null) }));

const SAVED: DayPortrait = {
  date: "2026-10-29",
  url: "https://example.invalid/portrait.jpg",
  capturedAt: "2026-10-29T14:00:00.000Z",
  sizeBytes: 123456,
};

function setGetUserMedia(impl: () => Promise<unknown>) {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: impl } });
}

describe("PortraitCapture", () => {
  beforeEach(() => {
    // jsdom has no media playback; the card calls play() on the live video.
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("invites a first portrait when the day has none", () => {
    render(<PortraitCapture date="2026-10-29" initial={null} />);
    expect(screen.getByText("No portrait for this day yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take portrait" })).toBeTruthy();
  });

  it("shows the saved portrait and offers a retake", () => {
    render(<PortraitCapture date="2026-10-29" initial={SAVED} />);
    const img = screen.getByRole("img", { name: "Portrait for 2026-10-29" });
    expect(img.getAttribute("src")).toBe(SAVED.url);
    expect(screen.getByRole("button", { name: "Retake portrait" })).toBeTruthy();
  });

  it("explains a blocked camera and stays on the idle state", async () => {
    setGetUserMedia(() => Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" })));
    render(<PortraitCapture date="2026-10-29" initial={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Take portrait" }));

    await waitFor(() => expect(screen.getByText(/Camera access was blocked/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Take portrait" })).toBeTruthy();
  });

  it("opens the camera, then releases it on Cancel", async () => {
    const stop = vi.fn();
    setGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop }] }));
    render(<PortraitCapture date="2026-10-29" initial={null} />);

    fireEvent.click(screen.getByRole("button", { name: "Take portrait" }));

    await waitFor(() => expect(screen.getByLabelText("Live camera preview")).toBeTruthy());
    // Capture waits for the camera to report its frame size.
    expect((screen.getByRole("button", { name: "Capture" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(stop).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Take portrait" })).toBeTruthy();
  });

  it("never lets a framing hint stop you taking the photo", async () => {
    setGetUserMedia(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }));
    render(<PortraitCapture date="2026-10-29" initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Take portrait" }));
    const video = (await screen.findByLabelText("Live camera preview")) as HTMLVideoElement;

    // The camera reports its size; the guide and its hint line appear.
    Object.defineProperty(video, "videoWidth", { value: 1920 });
    Object.defineProperty(video, "videoHeight", { value: 1080 });
    fireEvent.loadedMetadata(video);

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect((screen.getByRole("button", { name: "Capture" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
