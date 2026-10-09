"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoLogSummary } from "@/lib/video-journal/video-log-types";

// Keeps the Journal page in step with transcription (#341):
// - Starts transcription for any stored recording still at `uploaded`.
//   Normally the upload's completion already did; this covers a key added
//   later, or a kick-off that never ran.
// - While anything is transcribing, re-renders the server page every few
//   seconds (router.refresh) so status, transcript and the day's journal
//   text arrive without a manual reload. Playback isn't disturbed: the
//   playing <video> keeps the URL it started with.

const POLL_MS = 5000;
/** Stop polling eventually even if something never resolves; a reload
 * picks it up again. Past the server's abandoned-attempt threshold. */
const POLL_GIVE_UP_MS = 20 * 60 * 1000;

export type TranscriptionSync = {
  /** True once the server has said transcription isn't set up (503). */
  notConfigured: boolean;
  retry: (id: string) => Promise<void>;
  error: string | null;
};

async function startTranscription(id: string): Promise<"started" | "busy" | "not-configured"> {
  const res = await fetch(`/api/video-logs/${id}/transcribe`, { method: "POST" });
  if (res.status === 503) return "not-configured";
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
  }
  const body = (await res.json()) as { started: boolean };
  return body.started ? "started" : "busy";
}

export function useTranscriptionSync(videoLogs: VideoLogSummary[]): TranscriptionSync {
  const router = useRouter();
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptedRef = useRef(new Set<string>());
  const pollStartedRef = useRef<number | null>(null);

  useEffect(() => {
    if (notConfigured) return;
    const toStart = videoLogs.filter((l) => l.status === "uploaded" && !attemptedRef.current.has(l.id));
    if (toStart.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const log of toStart) {
        attemptedRef.current.add(log.id);
        try {
          const result = await startTranscription(log.id);
          if (cancelled) return;
          if (result === "not-configured") {
            setNotConfigured(true);
            return;
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't start transcription");
        }
      }
      if (!cancelled) router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [videoLogs, notConfigured, router]);

  const inFlight = videoLogs.some(
    (l) => (l.status === "transcribing" && !l.transcriptionStale) || (l.status === "uploaded" && !notConfigured),
  );

  useEffect(() => {
    if (!inFlight) {
      pollStartedRef.current = null;
      return;
    }
    pollStartedRef.current ??= Date.now();
    const id = window.setInterval(() => {
      if (pollStartedRef.current !== null && Date.now() - pollStartedRef.current > POLL_GIVE_UP_MS) {
        window.clearInterval(id);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [inFlight, router]);

  const retry = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const result = await startTranscription(id);
        if (result === "not-configured") setNotConfigured(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't start transcription");
      }
      router.refresh();
    },
    [router],
  );

  return { notConfigured, retry, error };
}
