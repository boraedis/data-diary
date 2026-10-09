// On-device safety net for video journal recordings (#340, epic #338).
//
// Every chunk MediaRecorder hands over is written to IndexedDB as it
// arrives, rather than held in a JS array until "stop". Two reasons, both
// from #338's 2026-10-08 decisions (recordings can run long, and a long
// log must never be lost):
// - A crashed tab, a killed camera or a dead battery loses at most the
//   last chunk. Whatever was written survives a reload and shows up as an
//   interrupted recording that can still be played, downloaded or (once
//   #339 lands) uploaded.
// - A 30-minute take is a few hundred MB. Holding that in memory is
//   exactly what gets an iPhone Safari tab killed. Blobs read back out of
//   IndexedDB are disk-backed, so assembling the finished file doesn't
//   need it all in RAM.
//
// A recording stays here until something explicitly deletes it: either
// R2 confirming the upload (src/components/journal/use-recording-uploads.ts,
// #339) or the Discard button. This module is the hand-off seam between
// the recorder and the uploader: the recorder only ever writes here, and
// the uploader only ever reads from here.
//
// Plain IndexedDB with a few promise helpers, no wrapper library. The
// surface is two object stores, and a dependency for that isn't worth it.

const DB_NAME = "data-diary-video-journal";
const DB_VERSION = 1;
const RECORDINGS = "recordings";
const CHUNKS = "chunks";

/** "recording" until the recorder's stop completes. A row still in that
 * state on a later page load was interrupted mid-take. */
export type LocalRecordingState = "recording" | "recorded";

export type LocalRecording = {
  id: string;
  /** The diary day it belongs to ("YYYY-MM-DD"), not when it was filmed. */
  date: string;
  mimeType: string;
  /** ISO timestamp, from the device clock. */
  startedAt: string;
  endedAt: string | null;
  /** Kept current as chunks arrive, so an interrupted recording still
   * knows roughly how long it is. */
  durationMs: number;
  bytes: number;
  chunkCount: number;
  state: LocalRecordingState;
};

type StoredChunk = { recordingId: string; seq: number; blob: Blob };

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDINGS)) {
        const recordings = db.createObjectStore(RECORDINGS, { keyPath: "id" });
        recordings.createIndex("date", "date");
      }
      if (!db.objectStoreNames.contains(CHUNKS)) {
        // Compound key, so chunks come back in recording order from a
        // plain key-range read and a re-delivered chunk overwrites itself
        // rather than duplicating.
        const chunks = db.createObjectStore(CHUNKS, { keyPath: ["recordingId", "seq"] });
        chunks.createIndex("recordingId", "recordingId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    // Another tab holding an older version open. Not reachable at
    // DB_VERSION 1, but a future schema bump would otherwise hang silently.
    request.onblocked = () => reject(new Error("Local recording storage is blocked by another open tab"));
  });
  // Don't cache a failure: a later call (e.g. after the user leaves
  // private browsing) should get to try again.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** True if this browser will actually let us store recordings. Private
 * browsing and locked-down profiles can expose `indexedDB` and still
 * refuse to open it, so this tries rather than feature-detects. */
export async function isLocalStoreAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

export async function createLocalRecording(recording: LocalRecording): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(RECORDINGS, "readwrite");
  tx.objectStore(RECORDINGS).put(recording);
  await transactionDone(tx);
}

/**
 * Stores one MediaRecorder chunk and bumps the recording's running
 * totals, atomically. The read-modify-write uses request callbacks rather
 * than `await`: an IndexedDB transaction auto-commits once control returns
 * to the event loop with nothing pending, and older Safari did that
 * between promise ticks.
 */
export async function appendLocalChunk(
  recordingId: string,
  seq: number,
  blob: Blob,
  elapsedMs: number,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readwrite");
  const chunk: StoredChunk = { recordingId, seq, blob };
  tx.objectStore(CHUNKS).put(chunk);
  const recordings = tx.objectStore(RECORDINGS);
  const get = recordings.get(recordingId);
  get.onsuccess = () => {
    const current = get.result as LocalRecording | undefined;
    if (!current) return;
    recordings.put({
      ...current,
      bytes: current.bytes + blob.size,
      chunkCount: current.chunkCount + 1,
      durationMs: Math.max(current.durationMs, elapsedMs),
    } satisfies LocalRecording);
  };
  await transactionDone(tx);
}

export async function finishLocalRecording(recordingId: string, durationMs: number, endedAt: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(RECORDINGS, "readwrite");
  const recordings = tx.objectStore(RECORDINGS);
  const get = recordings.get(recordingId);
  get.onsuccess = () => {
    const current = get.result as LocalRecording | undefined;
    if (!current) return;
    recordings.put({ ...current, durationMs, endedAt, state: "recorded" } satisfies LocalRecording);
  };
  await transactionDone(tx);
}

/** This device's recordings for one diary day, newest first. */
export async function listLocalRecordings(date: string): Promise<LocalRecording[]> {
  const db = await openDb();
  const tx = db.transaction(RECORDINGS, "readonly");
  const rows = await requestResult(tx.objectStore(RECORDINGS).index("date").getAll(date) as IDBRequest<LocalRecording[]>);
  return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Every recording on this device, any day, oldest first: the upload
 * queue's view, since a take recorded on one day's page still has to
 * upload if you next open a different day. */
export async function listAllLocalRecordings(): Promise<LocalRecording[]> {
  const db = await openDb();
  const tx = db.transaction(RECORDINGS, "readonly");
  const rows = await requestResult(tx.objectStore(RECORDINGS).getAll() as IDBRequest<LocalRecording[]>);
  return rows.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Reassembles a recording's chunks into one playable file. Works for an
 * interrupted recording too: MP4 recorded with a timeslice is fragmented
 * and WebM is a stream, so a file cut off at a chunk boundary still plays
 * up to that point. */
export async function loadLocalRecordingBlob(recording: LocalRecording): Promise<Blob> {
  const db = await openDb();
  const tx = db.transaction(CHUNKS, "readonly");
  const chunks = await requestResult(
    tx.objectStore(CHUNKS).index("recordingId").getAll(recording.id) as IDBRequest<StoredChunk[]>,
  );
  chunks.sort((a, b) => a.seq - b.seq);
  return new Blob(
    chunks.map((c) => c.blob),
    { type: recording.mimeType },
  );
}

export async function deleteLocalRecording(recordingId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readwrite");
  tx.objectStore(RECORDINGS).delete(recordingId);
  // The compound key's second part spans every possible seq, so one range
  // delete clears all of this recording's chunks without listing them.
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([recordingId, -Infinity], [recordingId, Infinity]));
  await transactionDone(tx);
}
