"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteLocalRecording,
  finishLocalRecording,
  listAllLocalRecordings,
  loadLocalRecordingBlob,
  type LocalRecording,
} from "@/lib/video-journal/local-store";
import { UploadNotConfiguredError, uploadRecording } from "@/lib/video-journal/uploader";

// The upload queue for recordings saved on this device (#339). Drains
// every local recording, from any day, to R2 one at a time, and deletes
// the local copy only after the server confirms the upload is complete
// and verified. Runs on mount, after each new recording, when the browser
// comes back online, and on Retry.

export type UploadStatus =
  | { kind: "uploading"; sentBytes: number; totalBytes: number }
  | { kind: "failed"; message: string }
  | { kind: "not-configured" };

export function useRecordingUploads({
  enabled,
  activeId,
  onUploaded,
}: {
  /** False until the local store has been checked and found usable. */
  enabled: boolean;
  /** The take currently being recorded: never upload it mid-take. */
  activeId: string | null;
  onUploaded: (recording: LocalRecording) => void;
}) {
  const [statuses, setStatuses] = useState<Record<string, UploadStatus>>({});
  const busyRef = useRef(false);
  const rerunRef = useRef(false);
  // Read inside the async loop, which outlives the render it started in.
  const activeIdRef = useRef(activeId);
  const onUploadedRef = useRef(onUploaded);
  useEffect(() => {
    activeIdRef.current = activeId;
    onUploadedRef.current = onUploaded;
  }, [activeId, onUploaded]);

  const setStatus = useCallback((id: string, status: UploadStatus | null) => {
    setStatuses((prev) => {
      const next = { ...prev };
      if (status) next[id] = status;
      else delete next[id];
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    // One pass at a time. A request during a pass (a new take finished
    // while an old one uploads) schedules exactly one more pass.
    if (busyRef.current) {
      rerunRef.current = true;
      return;
    }
    busyRef.current = true;
    try {
      do {
        rerunRef.current = false;
        const rows = await listAllLocalRecordings().catch(() => [] as LocalRecording[]);
        for (const row of rows) {
          if (row.id === activeIdRef.current) continue;
          if (row.state === "recording") {
            // Left over from an interrupted take (crash, reload): it's as
            // finished as it will ever be, so upload what was saved.
            await finishLocalRecording(row.id, row.durationMs, new Date().toISOString()).catch(() => {});
          }
          setStatus(row.id, { kind: "uploading", sentBytes: 0, totalBytes: row.bytes });
          try {
            const blob = await loadLocalRecordingBlob(row);
            await uploadRecording(
              {
                id: row.id,
                date: row.date,
                mimeType: row.mimeType,
                durationMs: row.durationMs,
                recordedAt: row.startedAt,
                blob,
              },
              { onProgress: (p) => setStatus(row.id, { kind: "uploading", ...p }) },
            );
            await deleteLocalRecording(row.id);
            setStatus(row.id, null);
            onUploadedRef.current(row);
          } catch (error) {
            if (error instanceof UploadNotConfiguredError) {
              // Same answer for every recording; stop asking.
              for (const r of rows) setStatus(r.id, { kind: "not-configured" });
              return;
            }
            setStatus(row.id, {
              kind: "failed",
              message: error instanceof Error ? error.message : "Upload failed",
            });
          }
        }
      } while (rerunRef.current);
    } finally {
      busyRef.current = false;
    }
  }, [setStatus]);

  useEffect(() => {
    if (!enabled) return;
    void run();
    const onOnline = () => void run();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [enabled, run]);

  return { statuses, runUploads: run };
}
