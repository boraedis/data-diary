"use client";

import { useCallback, useRef, useState } from "react";
import type { HudLocationState } from "@/components/journal/mission-hud";
import type { HudLocation, HudWeather } from "@/lib/video-journal/hud";

// Live location + weather for the mission HUD (#599). Always the device's
// own GPS fix, reverse-geocoded on the server into City, Country, never the
// diary's saved places (owner's call on #599).
//
// Captured when the camera turns on rather than when recording starts, so
// the browser's location permission prompt (first time only) appears
// alongside the camera prompt instead of interrupting a take. The recorder
// stamps whatever is known at record start into the recording's snapshot,
// and fills it in if the lookup finishes after recording has started.
//
// Never throws and never blocks recording: a denied permission or failed
// lookup just leaves that part of the HUD as "NO GPS SIGNAL" or empty.

export type HudContext = { location: HudLocation | null; weather: HudWeather | null; capturedAt: number };

const GEO_TIMEOUT_MS = 10_000;
/** A fix this recent is reused rather than asking again. */
const GEO_MAX_AGE_MS = 60_000;

function currentPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: GEO_TIMEOUT_MS,
      maximumAge: GEO_MAX_AGE_MS,
    });
  });
}

export function useHudContext() {
  const [location, setLocation] = useState<HudLocationState>({ kind: "pending" });
  const [weather, setWeather] = useState<HudWeather | null>(null);
  /** The latest completed capture, for the recorder to stamp into a
   * recording without waiting for a re-render. */
  const latestRef = useRef<HudContext | null>(null);
  const inflightRef = useRef<Promise<HudContext> | null>(null);

  const capture = useCallback((): Promise<HudContext> => {
    if (inflightRef.current) return inflightRef.current;
    const run = (async (): Promise<HudContext> => {
      setLocation((prev) => (prev.kind === "ok" ? prev : { kind: "pending" }));
      const pos = await currentPosition();
      if (!pos) {
        setLocation({ kind: "unavailable" });
        setWeather(null);
        const ctx = { location: null, weather: null, capturedAt: Date.now() };
        latestRef.current = ctx;
        return ctx;
      }
      let loc: HudLocation = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
        city: null,
        region: null,
        country: null,
        countryName: null,
      };
      // Coordinates straight away; City, Country and weather when the
      // server answers.
      setLocation({ kind: "ok", location: loc });
      let wx: HudWeather | null = null;
      try {
        const res = await fetch("/api/video-logs/hud-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: loc.lat, lng: loc.lng }),
        });
        if (res.ok) {
          const body = (await res.json()) as {
            place: { city: string | null; region: string | null; country: string | null; countryName: string | null } | null;
            weather: HudWeather | null;
          };
          if (body.place) loc = { ...loc, ...body.place };
          wx = body.weather;
        }
      } catch {
        // Offline or the lookup failed: keep the bare coordinates.
      }
      setLocation({ kind: "ok", location: loc });
      setWeather(wx);
      const ctx = { location: loc, weather: wx, capturedAt: Date.now() };
      latestRef.current = ctx;
      return ctx;
    })();
    inflightRef.current = run;
    void run.finally(() => {
      inflightRef.current = null;
    });
    return run;
  }, []);

  return { location, weather, capture, latestRef };
}
