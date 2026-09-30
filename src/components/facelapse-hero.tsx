"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

// The facelapse (epic #15): ~250 eye-aligned photos from 2005 on, made
// offline by the standalone tool at github.com/boraedis/facelapse (#457) and
// hosted on Vercel Blob per the static asset strategy (#163), not in git.
// Each upload gets a random suffix, so next year's re-render means new URLs
// here, which also re-arms the play-once rule below for returning visitors.
const BLOB = "https://ieufyfq2bbp41wru.public.blob.vercel-storage.com/facelapse";
// Hero version: photos dropping onto a pile of polaroids, rendered on the
// dark --background colour so it sits on the page rather than in a box
// (the site only has the dark theme; see layout.tsx). 720px, ~2.8MB, 15s.
const STACK_URL = `${BLOB}/polaroid-dark-720-WH62g2pmXGBkHBbTjJRdJk4ZvW9v5B.mp4`;
// The finished pile, i.e. the video's last frame: what repeat visitors and
// reduced-motion visitors see. It closes on one big, straight, centred
// print of the /about-me portrait (hard-set via the tool's final.txt),
// whatever the latest dated photo happens to be.
const STILL_URL = `${BLOB}/polaroid-dark-720-poster-W4jvO4gH5MuEYIh2DLbw9MqqIimVKF.webp`;
// "Full view": the plain one-photo-per-frame timelapse, ~23s, only fetched
// when someone opens it.
const FULL_URL = `${BLOB}/full-720-fA8PBS1qLhDIUuFrDtXhNuf2t3fmlB.mp4`;

// Keyed to the video URL rather than a boolean, so a new render plays once
// again for everyone who saw the old one.
const SEEN_KEY = "facelapse-seen";

type Mode = "unknown" | "playing" | "still";

function hasSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === STACK_URL;
  } catch {
    // Private windows and blocked storage throw; treat as a first visit,
    // which only costs a replay.
    return false;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, STACK_URL);
  } catch {
    // Same as above: failing to remember just means it plays again.
  }
}

/** Plays once per browser, then shows the finished pile (#15 decision 2).
 *
 * Nothing is drawn until mount decides which of the two applies: rendering
 * the still first would flash the ending before the animation on a first
 * visit, and rendering the video first would start a 2.8MB download for
 * every repeat visitor who is only going to see the still. */
export function FacelapseHero() {
  const [mode, setMode] = useState<Mode>("unknown");
  const [fullOpen, setFullOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Deciding needs localStorage and matchMedia, which only exist in the
    // browser, so this has to run after mount rather than during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(reduceMotion || hasSeen() ? "still" : "playing");
  }, []);

  useEffect(() => {
    if (mode !== "playing") return;
    // Autoplay can still be refused (iOS Low Power Mode, some browser
    // settings) even muted; fall back to the still instead of a frozen
    // first frame.
    videoRef.current?.play().catch(() => setMode("still"));
  }, [mode]);

  function finish() {
    markSeen();
    setMode("still");
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        // The video is rendered on the flat --background colour, but the hero
        // has a faint gradient wash over it, so the square still showed as a
        // slightly darker box. `lighten` drops every pixel darker than the
        // page behind it: the flat background vanishes and the (much
        // lighter) polaroids stay. Only the very darkest photo shadows lift
        // to the page colour. A radial mask was tried first and cut into the
        // card corners.
        className="relative aspect-square w-[min(78vw,400px)] mix-blend-lighten"
      >
        {mode === "still" && (
          <Image
            src={STILL_URL}
            alt="A pile of polaroid photos of the author, the most recent on top"
            fill
            sizes="(max-width: 640px) 78vw, 400px"
            preload
            className="object-contain"
          />
        )}
        {mode === "playing" && (
          <video
            ref={videoRef}
            src={STACK_URL}
            muted
            playsInline
            preload="auto"
            onEnded={finish}
            aria-label="Timelapse of the author's face from 2005 to today, each photo landing on a pile of polaroids"
            className="absolute inset-0 size-full object-contain"
          />
        )}
      </div>

      <div className="flex min-h-8 items-center gap-1">
        {mode === "playing" && (
          <button type="button" onClick={finish} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Skip
          </button>
        )}
        {mode === "still" && (
          <>
            <button
              type="button"
              onClick={() => setMode("playing")}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Replay
            </button>
            <button
              type="button"
              onClick={() => setFullOpen(true)}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Full view
            </button>
          </>
        )}
      </div>

      <Modal
        open={fullOpen}
        onClose={() => setFullOpen(false)}
        title="Facelapse, 2005 to today"
        panelClassName="max-w-2xl"
      >
        {/* Opened by a click, so it can play with controls straight away. */}
        <video src={FULL_URL} controls autoPlay playsInline className="w-full rounded-lg" />
      </Modal>
    </div>
  );
}
