"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StoredRecordings } from "@/components/journal/stored-recordings";
import { useRecordingUploads, type UploadStatus } from "@/components/journal/use-recording-uploads";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import {
  AUDIO_BITS_PER_SECOND,
  CAPTURE_CONSTRAINTS,
  classifyRecorderError,
  effectiveMbps,
  extensionForMimeType,
  formatBytes,
  formatElapsed,
  pickRecordingMimeType,
  RECORDING_TIMESLICE_MS,
  VIDEO_BITS_PER_SECOND,
  type RecorderErrorKind,
} from "@/lib/video-journal/recording";
import {
  appendLocalChunk,
  createLocalRecording,
  deleteLocalRecording,
  finishLocalRecording,
  isLocalStoreAvailable,
  listLocalRecordings,
  loadLocalRecordingBlob,
  type LocalRecording,
} from "@/lib/video-journal/local-store";
import { UploadNotConfiguredError, uploadRecording } from "@/lib/video-journal/uploader";
import type { VideoLogSummary } from "@/lib/video-journal/video-log-types";

// In-browser video journal recorder (#340, epic #338). Records the front
// camera + mic with MediaRecorder and writes each chunk to IndexedDB as it
// arrives (src/lib/video-journal/local-store.ts), so a long take survives
// a crashed tab. Finished takes then upload to R2 in the background
// (use-recording-uploads.ts, #339) and leave the device only once the
// server has verified the stored copy. Transcription (#341) and the
// mission HUD overlay (#599) build on top of this.
//
// The camera is never requested on page load. Opening the Journal section
// to write shouldn't light up the camera or throw a permission prompt;
// "Turn on camera" is an explicit step.

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "recording"; startedAt: number }
  | { kind: "finishing" }
  | { kind: "error"; error: RecorderErrorKind; detail: string | null };

type WakeLockStatus = "unsupported" | "off" | "on" | "failed";

/** A recording that couldn't be (fully) written to IndexedDB, so it only
 * exists in this tab's memory. Leaving the page loses it, hence the
 * unsaved-changes guard and the "download it now" warning. */
type MemoryRecording = {
  blob: Blob;
  mimeType: string;
  startedAt: string;
  durationMs: number;
};

const ERROR_ADVICE: Record<RecorderErrorKind, string> = {
  permission:
    "Camera or microphone access was blocked. On iPhone: Settings → Apps → Safari → Camera/Microphone, or the aA menu → Website Settings. On Mac: the camera icon in the address bar. Then try again.",
  "no-device": "No camera or microphone was found.",
  "in-use": "The camera or microphone is in use by another app or tab. Close it and try again.",
  unsupported: "This browser can't record video here. Try Safari or an up-to-date Chrome.",
  insecure:
    "Camera access needs a secure (https) page. Use the deployed app or a preview deployment, not a LAN http:// address.",
  unknown: "Something went wrong starting the camera.",
};

export function VideoRecorder({
  date,
  videoLogs,
  videoLogsError,
}: {
  date: string;
  videoLogs: VideoLogSummary[];
  /** Why the day's stored recordings couldn't be listed, if they
   * couldn't. Recording and on-device storage still work. */
  videoLogsError: string | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [wakeLock, setWakeLock] = useState<WakeLockStatus>("off");
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [localRecordings, setLocalRecordings] = useState<LocalRecording[]>([]);
  const [localAvailable, setLocalAvailable] = useState<boolean | null>(null);
  const [memoryRecording, setMemoryRecording] = useState<MemoryRecording | null>(null);
  const [memoryUpload, setMemoryUpload] = useState<UploadStatus | null>(null);
  const [playback, setPlayback] = useState<{ id: string; url: string } | null>(null);
  // The take in progress, so the list below doesn't badge it as an
  // interrupted leftover while it's still being written.
  const [activeId, setActiveId] = useState<string | null>(null);

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // Per-recording bookkeeping. Refs, not state: they change on every
  // chunk and nothing renders from them directly.
  const startedAtRef = useRef<number>(0);
  const seqRef = useRef(0);
  // Chunk writes are chained so they land in order and "stop" can wait
  // for the last one before marking the recording finished.
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const writesFailedRef = useRef(false);
  const memoryChunksRef = useRef<{ seq: number; blob: Blob }[]>([]);
  const interruptedRef = useRef(false);

  const recording = phase.kind === "recording";
  // Leaving mid-take stops the recording, and a memory-only recording is
  // lost outright, so both are worth the same prompt as unsaved text.
  useUnsavedChangesGuard(recording || memoryRecording !== null);

  const refreshLocal = useCallback(async () => {
    try {
      setLocalRecordings(await listLocalRecordings(date));
    } catch {
      setLocalRecordings([]);
    }
  }, [date]);

  const onUploaded = useCallback(() => {
    void refreshLocal();
    // Re-render the server half of the page so the stored list picks up
    // the new row (and a fresh playback URL).
    router.refresh();
  }, [refreshLocal, router]);

  const { statuses: uploadStatuses, runUploads } = useRecordingUploads({
    enabled: localAvailable === true,
    activeId,
    onUploaded,
  });

  useEffect(() => {
    let cancelled = false;
    isLocalStoreAvailable().then((ok) => {
      if (cancelled) return;
      setLocalAvailable(ok);
      if (ok) void refreshLocal();
    });
    return () => {
      cancelled = true;
    };
  }, [refreshLocal]);

  // Elapsed clock. React state is fine here: it re-renders a few DOM
  // nodes four times a second, not a chart.
  useEffect(() => {
    if (phase.kind !== "recording") return;
    const startedAt = phase.startedAt;
    const tick = () => setElapsedMs(nowMs() - startedAt);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setWakeLock((s) => (s === "unsupported" ? s : "off"));
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) {
      setWakeLock("unsupported");
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setWakeLock("on");
      wakeLockRef.current.addEventListener("release", () => {
        // The browser drops the lock whenever the page is hidden; the
        // visibility handler below re-takes it on return.
        setWakeLock((s) => (s === "on" ? "off" : s));
      });
    } catch {
      setWakeLock("failed");
    }
  }, []);

  // iPhone Safari stops a recording when the screen locks, and a wake
  // lock is released whenever the page is hidden, so re-take it on return.
  useEffect(() => {
    if (!recording) return;
    const onVisible = () => {
      if (document.visibilityState === "visible" && !wakeLockRef.current) void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [recording, acquireWakeLock]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  }, []);

  // Unmount (navigating away): stop everything rather than leave the
  // camera light on. A take in progress is finalised by its onstop
  // handler, and its chunks are already in IndexedDB.
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      wakeLockRef.current?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    return () => {
      // Only object URLs need releasing; a stored recording plays from a
      // presigned R2 URL.
      if (playback?.url.startsWith("blob:")) URL.revokeObjectURL(playback.url);
    };
  }, [playback]);

  async function startCamera() {
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase({ kind: "error", error: window.isSecureContext ? "unsupported" : "insecure", detail: null });
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setPhase({ kind: "error", error: "unsupported", detail: "MediaRecorder is not available" });
      return;
    }
    const chosen = pickRecordingMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!chosen) {
      setPhase({ kind: "error", error: "unsupported", detail: "No supported recording format" });
      return;
    }
    setMimeType(chosen);
    setPhase({ kind: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAPTURE_CONSTRAINTS);
      streamRef.current = stream;
      const settings = stream.getVideoTracks()[0]?.getSettings();
      setResolution(
        settings?.width && settings?.height
          ? `${settings.width}×${settings.height}${settings.frameRate ? ` @ ${Math.round(settings.frameRate)}fps` : ""}`
          : null,
      );
      for (const track of stream.getTracks()) {
        // Camera or mic taken away mid-take (screen locked, app switched,
        // another app grabbed the camera): finish with what we have
        // rather than leaving a recorder that silently records nothing.
        track.addEventListener("ended", () => {
          if (recorderRef.current?.state === "recording") {
            interruptedRef.current = true;
            recorderRef.current.stop();
          }
        });
      }
      setPhase({ kind: "ready" });
    } catch (error) {
      setPhase({
        kind: "error",
        error: classifyRecorderError(error),
        detail: error instanceof Error ? error.message : null,
      });
    }
  }

  // Attach the stream once the <video> exists, i.e. after the phase
  // change that renders it.
  useEffect(() => {
    if ((phase.kind === "ready" || phase.kind === "recording") && liveVideoRef.current && streamRef.current) {
      if (liveVideoRef.current.srcObject !== streamRef.current) liveVideoRef.current.srcObject = streamRef.current;
    }
  }, [phase.kind]);

  async function startRecording() {
    const stream = streamRef.current;
    if (!stream || !mimeType) return;
    setNotice(null);
    setPlayback(null);

    const id = crypto.randomUUID();
    const startedAt = nowMs();
    setActiveId(id);
    startedAtRef.current = startedAt;
    seqRef.current = 0;
    writeChainRef.current = Promise.resolve();
    memoryChunksRef.current = [];
    interruptedRef.current = false;
    // No local store at all: record into memory from the first chunk.
    writesFailedRef.current = localAvailable !== true;

    if (localAvailable) {
      try {
        await createLocalRecording({
          id,
          date,
          mimeType,
          startedAt: new Date(startedAt).toISOString(),
          endedAt: null,
          durationMs: 0,
          bytes: 0,
          chunkCount: 0,
          state: "recording",
        });
      } catch {
        writesFailedRef.current = true;
      }
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch (error) {
      setPhase({
        kind: "error",
        error: "unsupported",
        detail: error instanceof Error ? error.message : "Could not create MediaRecorder",
      });
      return;
    }
    recorderRef.current = recorder;

    recorder.addEventListener("dataavailable", (event) => {
      if (!event.data || event.data.size === 0) return;
      const seq = seqRef.current++;
      const blob = event.data;
      const elapsed = nowMs() - startedAtRef.current;
      writeChainRef.current = writeChainRef.current.then(async () => {
        if (writesFailedRef.current) {
          memoryChunksRef.current.push({ seq, blob });
          return;
        }
        try {
          await appendLocalChunk(id, seq, blob, elapsed);
        } catch {
          // Most likely storage quota. Keep going in memory: the take
          // still finishes, and the UI says to download it.
          writesFailedRef.current = true;
          memoryChunksRef.current.push({ seq, blob });
        }
      });
    });

    recorder.addEventListener("error", () => {
      interruptedRef.current = true;
      if (recorder.state !== "inactive") recorder.stop();
    });

    recorder.addEventListener("stop", () => {
      void finishRecording(id);
    });

    recorder.start(RECORDING_TIMESLICE_MS);
    setElapsedMs(0);
    setPhase({ kind: "recording", startedAt });
    void acquireWakeLock();
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      setPhase({ kind: "finishing" });
      recorder.stop();
    }
  }

  async function finishRecording(id: string) {
    setPhase({ kind: "finishing" });
    releaseWakeLock();
    // The final dataavailable fires before "stop", so its write is
    // already on the chain.
    await writeChainRef.current;
    const durationMs = nowMs() - startedAtRef.current;
    const startedAtIso = new Date(startedAtRef.current).toISOString();
    recorderRef.current = null;
    stopCamera();

    let storedLocally = false;
    if (localAvailable) {
      try {
        await finishLocalRecording(id, durationMs, new Date().toISOString());
        storedLocally = true;
      } catch {
        // Fall through: whatever reached IndexedDB is still listed as an
        // interrupted recording on the next load.
      }
    }

    if (writesFailedRef.current) {
      // Part (or all) of the take only exists in memory. Stitch the
      // stored prefix and the in-memory tail back into one file.
      let prefix: Blob | null = null;
      if (storedLocally) {
        const row = (await listLocalRecordings(date).catch(() => [])).find((r) => r.id === id);
        if (row) prefix = await loadLocalRecordingBlob(row).catch(() => null);
      }
      const tail = memoryChunksRef.current.sort((a, b) => a.seq - b.seq).map((c) => c.blob);
      const blob = new Blob(prefix ? [prefix, ...tail] : tail, { type: mimeType ?? "video/mp4" });
      memoryChunksRef.current = [];
      setMemoryRecording({ blob, mimeType: mimeType ?? "video/mp4", startedAt: startedAtIso, durationMs });
      setPlayback({ id: "memory", url: URL.createObjectURL(blob) });
      // activeId stays set: it keeps the background queue away from the
      // partial copy in IndexedDB, which shares this id but not its size,
      // while the complete in-memory file uploads.
      setNotice(
        "This recording couldn't be fully saved on this device (storage may be full). It's uploading straight from memory; download it too if you can, before leaving this page.",
      );
      void uploadFromMemory({ blob, mimeType: mimeType ?? "video/mp4", startedAt: startedAtIso, durationMs }, id);
    } else {
      setActiveId(null);
      void runUploads();
      await refreshLocal();
      await openPlayback(id);
      if (interruptedRef.current) {
        setNotice(
          "Recording stopped early because the camera or microphone was interrupted (screen lock, app switch or another app). Everything up to that point is saved.",
        );
      }
    }
    setPhase({ kind: "idle" });
  }

  /** Upload for a take that never fully reached IndexedDB. Same server
   * flow, but there's no local copy to resume from, so a failure here is
   * only recoverable by downloading the file. */
  async function uploadFromMemory(recording: MemoryRecording, id: string) {
    setMemoryUpload({ kind: "uploading", sentBytes: 0, totalBytes: recording.blob.size });
    try {
      await uploadRecording(
        {
          id,
          date,
          mimeType: recording.mimeType,
          durationMs: recording.durationMs,
          recordedAt: recording.startedAt,
          blob: recording.blob,
        },
        { onProgress: (p) => setMemoryUpload({ kind: "uploading", ...p }) },
      );
      // The partial prefix in IndexedDB (if any) is superseded by the
      // complete upload.
      await deleteLocalRecording(id).catch(() => {});
      setActiveId((current) => (current === id ? null : current));
      setMemoryUpload(null);
      setMemoryRecording(null);
      setNotice(null);
      onUploaded();
    } catch (error) {
      setMemoryUpload(
        error instanceof UploadNotConfiguredError
          ? { kind: "not-configured" }
          : { kind: "failed", message: error instanceof Error ? error.message : "Upload failed" },
      );
    }
  }

  async function openPlayback(id: string) {
    const row = (await listLocalRecordings(date).catch(() => [])).find((r) => r.id === id);
    if (!row) return;
    try {
      const blob = await loadLocalRecordingBlob(row);
      setPlayback({ id, url: URL.createObjectURL(blob) });
    } catch {
      setNotice("Couldn't load that recording from this device.");
    }
  }

  async function downloadLocal(row: LocalRecording) {
    try {
      const blob = await loadLocalRecordingBlob(row);
      triggerDownload(blob, downloadName(row.date, row.startedAt, row.mimeType));
    } catch {
      setNotice("Couldn't load that recording from this device.");
    }
  }

  async function discardLocal(row: LocalRecording) {
    const label = `${formatElapsed(row.durationMs)} recording from ${formatTime(row.startedAt)}`;
    if (!window.confirm(`Delete the ${label} from this device? It hasn't finished uploading, so this can't be undone.`)) {
      return;
    }
    await deleteLocalRecording(row.id).catch(() => {});
    if (playback?.id === row.id) setPlayback(null);
    await refreshLocal();
  }

  const lastStats = (() => {
    if (memoryRecording && playback?.id === "memory") {
      return { bytes: memoryRecording.blob.size, durationMs: memoryRecording.durationMs };
    }
    const row = localRecordings.find((r) => r.id === playback?.id);
    return row ? { bytes: row.bytes, durationMs: row.durationMs } : null;
  })();
  const lastMbps = lastStats ? effectiveMbps(lastStats.bytes, lastStats.durationMs) : null;

  const cameraOn = phase.kind === "ready" || phase.kind === "recording";

  return (
    <div className="flex flex-col gap-4">
      {cameraOn ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          {/* Mirrored like every selfie preview, so moving left moves
              left. The recorded file itself is not mirrored. */}
          <video
            ref={liveVideoRef}
            autoPlay
            muted
            playsInline
            className="mx-auto max-h-[70vh] w-full -scale-x-100 object-contain"
          />
          {recording ? (
            <div className="absolute top-3 left-3 flex items-center gap-2 rounded-md bg-black/60 px-2.5 py-1 font-mono text-sm text-white">
              <span className="size-2.5 animate-pulse rounded-full bg-red-500" aria-hidden />
              REC {formatElapsed(elapsedMs)}
            </div>
          ) : null}
        </div>
      ) : playback ? (
        <video
          key={playback.url}
          src={playback.url}
          controls
          playsInline
          className="mx-auto max-h-[70vh] w-full rounded-xl bg-black object-contain"
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {phase.kind === "idle" || phase.kind === "error" ? (
          <Button type="button" size="lg" onClick={startCamera}>
            {playback ? "Record another" : "Turn on camera"}
          </Button>
        ) : null}
        {phase.kind === "starting" ? (
          <Button type="button" size="lg" disabled>
            Starting camera…
          </Button>
        ) : null}
        {phase.kind === "ready" ? (
          <>
            <Button type="button" size="lg" onClick={startRecording}>
              Start recording
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => {
                stopCamera();
                setPhase({ kind: "idle" });
              }}
            >
              Turn off camera
            </Button>
          </>
        ) : null}
        {phase.kind === "recording" ? (
          <Button type="button" size="lg" variant="destructive" onClick={stopRecording}>
            Stop recording
          </Button>
        ) : null}
        {phase.kind === "finishing" ? (
          <Button type="button" size="lg" disabled>
            Saving…
          </Button>
        ) : null}
        {memoryRecording ? (
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={() => {
              triggerDownload(
                memoryRecording.blob,
                downloadName(date, memoryRecording.startedAt, memoryRecording.mimeType),
              );
              setMemoryRecording(null);
            }}
          >
            Download recording
          </Button>
        ) : null}
      </div>

      {recording && (wakeLock === "unsupported" || wakeLock === "failed") ? (
        <p className="text-sm text-muted-foreground">
          This browser can&apos;t keep the screen awake. Keep tapping it now and then: on iPhone, a locked screen ends
          the recording.
        </p>
      ) : null}

      {phase.kind === "error" ? (
        <p className="text-sm text-destructive">
          {ERROR_ADVICE[phase.error]}
          {phase.detail ? <span className="block text-xs opacity-80">({phase.detail})</span> : null}
        </p>
      ) : null}

      {notice ? <p className="text-sm text-amber-600 dark:text-amber-400">{notice}</p> : null}

      {localAvailable === false ? (
        <p className="text-sm text-muted-foreground">
          This browser won&apos;t let the app store recordings on the device (private browsing?), so a recording only
          lives in this tab until it&apos;s downloaded.
        </p>
      ) : null}

      {localRecordings.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">On this device</h3>
          <p className="text-xs text-muted-foreground">
            Kept here until the upload is confirmed, then removed from the device automatically.
          </p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {localRecordings.map((row) => {
              const interrupted = row.state === "recording" && row.id !== activeId;
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="flex flex-col">
                    <span className="font-mono text-sm">
                      {formatTime(row.startedAt)} · {formatElapsed(row.durationMs)} · {formatBytes(row.bytes)}
                    </span>
                    {interrupted ? (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        Interrupted, recovered up to the last saved second
                      </span>
                    ) : null}
                    <UploadStatusLine status={uploadStatuses[row.id]} />
                  </div>
                  <div className="flex gap-1.5">
                    {uploadStatuses[row.id]?.kind === "failed" ? (
                      <Button type="button" size="sm" onClick={() => void runUploads()}>
                        Retry
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" onClick={() => void openPlayback(row.id)}>
                      Play
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => void downloadLocal(row)}>
                      Download
                    </Button>
                    <Button type="button" size="sm" variant="destructive" onClick={() => void discardLocal(row)}>
                      Discard
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {memoryUpload ? <UploadStatusLine status={memoryUpload} /> : null}

      {videoLogsError ? (
        <p className="text-sm text-destructive">
          Couldn&apos;t load this day&apos;s stored recordings: {videoLogsError}. Recording still works, and new takes are
          kept on this device.
        </p>
      ) : null}

      <StoredRecordings
        recordings={videoLogs}
        playingId={playback?.id ?? null}
        onPlay={(log) => {
          if (log.playbackUrl) setPlayback({ id: log.id, url: log.playbackUrl });
        }}
      />

      {/* Device test readout for #340's matrix (iPhone Safari, Mac Safari,
          Mac Chrome): what this browser actually negotiated, so a test can
          be reported precisely rather than as "it worked". */}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Recording details</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono">
          <dt>Format</dt>
          <dd>{mimeType ?? "not chosen yet"}</dd>
          <dt>Camera</dt>
          <dd>{resolution ?? "off"}</dd>
          <dt>Target</dt>
          <dd>
            {(VIDEO_BITS_PER_SECOND / 1_000_000).toFixed(1)} Mbps video + {AUDIO_BITS_PER_SECOND / 1000} kbps audio
          </dd>
          <dt>Last take</dt>
          <dd>
            {lastStats
              ? `${formatBytes(lastStats.bytes)} in ${formatElapsed(lastStats.durationMs)}${lastMbps !== null ? ` (${lastMbps.toFixed(2)} Mbps)` : ""}`
              : "none"}
          </dd>
          <dt>Screen awake</dt>
          <dd>{wakeLock}</dd>
          <dt>Local backup</dt>
          <dd>{localAvailable === null ? "checking" : localAvailable ? "IndexedDB" : "unavailable"}</dd>
        </dl>
      </details>
    </div>
  );
}

/** Wall-clock milliseconds. A module-level wrapper because the React
 * compiler's purity lint can't tell that the recorder's async start/stop
 * handlers run in response to events rather than during render, and
 * flags a bare `Date.now()` in them. Nothing calls this during render. */
function nowMs(): number {
  return Date.now();
}

function UploadStatusLine({ status }: { status: UploadStatus | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">Waiting to upload</span>;
  switch (status.kind) {
    case "uploading": {
      const pct = status.totalBytes > 0 ? Math.floor((status.sentBytes / status.totalBytes) * 100) : 0;
      return (
        <span className="text-xs text-muted-foreground">
          Uploading… {pct}% ({formatBytes(status.sentBytes)} of {formatBytes(status.totalBytes)})
        </span>
      );
    }
    case "failed":
      return (
        <span className="text-xs text-destructive">
          Upload failed: {status.message}. It&apos;s still safe on this device.
        </span>
      );
    case "not-configured":
      return (
        <span className="text-xs text-muted-foreground">
          Video storage isn&apos;t set up on this deployment yet, so this stays on the device.
        </span>
      );
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "journal-2026-10-08-0914.mp4": the diary day plus the device-local
 * start time, so several takes on one day don't collide in Downloads. */
function downloadName(date: string, startedAtIso: string, mimeType: string): string {
  const started = new Date(startedAtIso);
  const hhmm = `${String(started.getHours()).padStart(2, "0")}${String(started.getMinutes()).padStart(2, "0")}`;
  return `journal-${date}-${hhmm}.${extensionForMimeType(mimeType)}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a delay: Safari can still be reading the URL when click()
  // returns, and revoking immediately cancels the download there.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
