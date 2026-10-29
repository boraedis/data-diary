"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { portraitGuide } from "@/lib/day-portraits/guide";
import {
  fitWithin,
  PORTRAIT_JPEG_QUALITY,
  PORTRAIT_MAX_EDGE_PX,
  type DayPortrait,
} from "@/lib/day-portraits/rules";
import { classifyRecorderError, type RecorderErrorKind } from "@/lib/video-journal/recording";

// The day's portrait (#622, #688): take one photo in the browser with a
// framing guide drawn over the live camera, so the facelapse's source
// frames come out at the same distance and height every day. Still capture,
// not recording, but the camera permission and failure modes are the video
// recorder's, so its classifier is reused.
//
// What it deliberately doesn't do: detect a face. The guide is a fixed
// overlay (v1); the facelapse tool does the real eye alignment afterwards.

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};

const CAMERA_ADVICE: Record<RecorderErrorKind, string> = {
  permission:
    "Camera access was blocked. On iPhone: Settings → Apps → Safari → Camera, or the aA menu → Website Settings. On Mac: the camera icon in the address bar. Then try again.",
  "no-device": "No camera was found.",
  "in-use": "The camera is in use by another app or tab. Close it and try again.",
  unsupported: "This browser can't use the camera here. Try Safari or an up-to-date Chrome.",
  insecure:
    "Camera access needs a secure (https) page. Use the deployed app or a preview deployment, not a LAN http:// address.",
  unknown: "Something went wrong starting the camera.",
};

type Phase = "idle" | "starting" | "live" | "review" | "saving";
type Captured = { blob: Blob; url: string; capturedAt: Date };

export function PortraitCapture({ date, initial }: { date: string; initial: DayPortrait | null }) {
  const router = useRouter();
  const [saved, setSaved] = useState<DayPortrait | null>(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The camera frame's real pixel size. The preview box takes this aspect
  // ratio and the guide is drawn in the same pixel space, so the guide sits
  // on the saved image exactly as it sat on the preview.
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setFrame(null);
  }, []);

  // Release the camera, and any captured preview, when leaving the page.
  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => {
    const url = captured?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [captured?.url]);

  // Hand the stream to the <video> once it is on screen.
  useEffect(() => {
    if (phase !== "live") return;
    const video = videoRef.current;
    if (video && streamRef.current) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => {
        // Autoplay can be refused until a gesture; the video element has
        // `autoPlay` too, and the tap that opened the camera counts.
      });
    }
  }, [phase]);

  async function startCamera() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(CAMERA_ADVICE[window.isSecureContext ? "unsupported" : "insecure"]);
      return;
    }
    setPhase("starting");
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      setPhase("live");
    } catch (cause) {
      setError(CAMERA_ADVICE[classifyRecorderError(cause)]);
      setPhase("idle");
    }
  }

  function cancelCamera() {
    stopCamera();
    setPhase("idle");
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const { width, height } = fitWithin(video.videoWidth, video.videoHeight, PORTRAIT_MAX_EDGE_PX);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("This browser can't capture a photo here.");
      return;
    }
    // Unmirrored: the preview is flipped like a mirror because that is how
    // people expect to line themselves up, but the saved photo is the true
    // view, which is what the facelapse should be made of.
    context.drawImage(video, 0, 0, width, height);
    const capturedAt = new Date();
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("Could not capture the photo. Try again.");
          return;
        }
        stopCamera();
        setCaptured({ blob, url: URL.createObjectURL(blob), capturedAt });
        setPhase("review");
      },
      "image/jpeg",
      PORTRAIT_JPEG_QUALITY,
    );
  }

  function retake() {
    setCaptured(null);
    void startCamera();
  }

  function discard() {
    setCaptured(null);
    setPhase("idle");
  }

  async function save() {
    if (!captured) return;
    setPhase("saving");
    setError(null);
    try {
      const res = await fetch(`/api/day-portraits/${date}`, {
        method: "PUT",
        headers: { "Content-Type": captured.blob.type || "image/jpeg", "X-Captured-At": captured.capturedAt.toISOString() },
        body: captured.blob,
      });
      const body = (await res.json().catch(() => null)) as { portrait?: DayPortrait; error?: string } | null;
      if (!res.ok || !body?.portrait) {
        setError(typeof body?.error === "string" ? body.error : "Failed to save the portrait");
        setPhase("review");
        return;
      }
      setSaved(body.portrait);
      setCaptured(null);
      setPhase("idle");
      router.refresh();
    } catch {
      setError("Network error — could not save. The photo is still here, so try again.");
      setPhase("review");
    }
  }

  const live = phase === "live";
  const showReview = (phase === "review" || phase === "saving") && captured;
  const guide = frame ? portraitGuide(frame.width, frame.height) : null;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Portrait</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Put your face in the oval and your eyes on the line, at the same distance and in the same light each day.
        </p>

        {live ? (
          <div
            className="relative w-full max-w-xl overflow-hidden rounded-lg bg-black"
            style={{ aspectRatio: frame ? `${frame.width} / ${frame.height}` : "16 / 9" }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label="Live camera preview"
              className="h-full w-full -scale-x-100"
              onLoadedMetadata={(event) => {
                const { videoWidth, videoHeight } = event.currentTarget;
                if (videoWidth && videoHeight) setFrame({ width: videoWidth, height: videoHeight });
              }}
            />
            {frame && guide ? (
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
                  stroke="white"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={guide.cx - guide.rx}
                  x2={guide.cx + guide.rx}
                  y1={guide.eyeY}
                  y2={guide.eyeY}
                  stroke="white"
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={guide.cx}
                  x2={guide.cx}
                  y1={guide.cy - guide.ry}
                  y2={guide.cy + guide.ry}
                  stroke="white"
                  strokeOpacity={0.5}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            ) : null}
          </div>
        ) : showReview ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not an optimizable asset
          <img src={captured.url} alt="The portrait you just took" className="w-full max-w-xl rounded-lg" />
        ) : saved ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived presigned R2 URL, not an optimizable asset
          <img src={saved.url} alt={`Portrait for ${date}`} className="w-full max-w-xl rounded-lg" />
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No portrait for this day yet.
          </p>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          {phase === "idle" || phase === "starting" ? (
            <Button type="button" onClick={startCamera} disabled={phase === "starting"}>
              {phase === "starting" ? "Starting camera…" : saved ? "Retake portrait" : "Take portrait"}
            </Button>
          ) : null}
          {live ? (
            <>
              <Button type="button" onClick={capture} disabled={!frame}>
                Capture
              </Button>
              <Button type="button" variant="outline" onClick={cancelCamera}>
                Cancel
              </Button>
            </>
          ) : null}
          {phase === "review" || phase === "saving" ? (
            <>
              <Button type="button" onClick={save} disabled={phase === "saving"}>
                {phase === "saving" ? "Saving…" : "Use this photo"}
              </Button>
              <Button type="button" variant="outline" onClick={retake} disabled={phase === "saving"}>
                Retake
              </Button>
              <Button type="button" variant="ghost" onClick={discard} disabled={phase === "saving"}>
                Discard
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
