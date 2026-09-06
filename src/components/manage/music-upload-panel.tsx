"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { MusicImportSummary } from "@/lib/music-import";

type FileResult = { fileName: string; summary: MusicImportSummary } | { fileName: string; error: string };

function emptyTotal() {
  return {
    filesProcessed: 0,
    entriesRead: 0,
    listensInserted: 0,
    listensSkipped: 0,
    artistsCreated: 0,
    podcastShowsCreated: 0,
  };
}

function mergeSummaries(a: MusicImportSummary | null, b: MusicImportSummary): MusicImportSummary {
  if (!a) return b;
  return {
    filesProcessed: a.filesProcessed, // one original file, no matter how many slices it took
    entriesRead: a.entriesRead + b.entriesRead,
    listensInserted: a.listensInserted + b.listensInserted,
    listensSkipped: a.listensSkipped + b.listensSkipped,
    artistsCreated: a.artistsCreated + b.artistsCreated,
    podcastShowsCreated: a.podcastShowsCreated + b.podcastShowsCreated,
    errors: [...a.errors, ...b.errors],
  };
}

// Vercel Functions hard-cap request bodies at 4.5MB, but Spotify's own
// export splitting produces files well above that (~12MB observed, see
// #192) — a file this size sent whole used to fail with a generic
// "Network error" once the platform rejected the oversized request before
// a clean response came back. Sized well under the real limit to leave
// headroom for JSON-array overhead (brackets/commas) around the estimate,
// which is based on the *whole* file's average bytes-per-entry and can run
// a bit high for any single slice.
const MAX_CHUNK_BYTES = 3_500_000;

function chunkEntries(entries: unknown[], fileByteLength: number): unknown[][] {
  if (entries.length === 0) return [[]];
  const bytesPerEntry = fileByteLength / entries.length;
  const perChunk = Math.max(1, Math.floor(MAX_CHUNK_BYTES / bytesPerEntry));
  const chunks: unknown[][] = [];
  for (let i = 0; i < entries.length; i += perChunk) {
    chunks.push(entries.slice(i, i + perChunk));
  }
  return chunks;
}

// Uploads Spotify "Extended Streaming History" export files. Each file is
// read and JSON.parsed here in the browser, then its entries are sent as
// one or more requests (chunkEntries splits large files, see its comment)
// rather than the whole file in one request — the files themselves never
// leave this request cycle either way, parsed and discarded server-side.
export function MusicUploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [currentChunk, setCurrentChunk] = useState<{ fileName: string; index: number; total: number } | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);

  async function handleFiles(files: FileList) {
    setUploading(true);
    setResults([]);
    const list = Array.from(files);
    setProgress({ done: 0, total: list.length });
    const collected: FileResult[] = [];

    for (const file of list) {
      let entries: unknown[];
      try {
        const parsed: unknown = JSON.parse(await file.text());
        if (!Array.isArray(parsed)) throw new Error("not an array");
        entries = parsed;
      } catch {
        collected.push({ fileName: file.name, error: "Could not parse as a Spotify export JSON array" });
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
        setResults([...collected]);
        continue;
      }

      const chunks = chunkEntries(entries, file.size);
      let merged: MusicImportSummary | null = null;
      let error: string | null = null;

      for (let i = 0; i < chunks.length; i++) {
        setCurrentChunk(chunks.length > 1 ? { fileName: file.name, index: i + 1, total: chunks.length } : null);
        try {
          const res = await fetch("/api/music/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: file.name, entries: chunks[i] }),
          });
          const body = await res.json();
          if (!res.ok) {
            error = typeof body?.error === "string" ? body.error : "Import failed";
            break;
          }
          merged = mergeSummaries(merged, body as MusicImportSummary);
        } catch {
          error = chunks.length > 1 ? `Network error (part ${i + 1}/${chunks.length})` : "Network error";
          break;
        }
      }

      collected.push(error ? { fileName: file.name, error } : { fileName: file.name, summary: merged! });
      setCurrentChunk(null);
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      setResults([...collected]);
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  const total = results.reduce((acc, r) => {
    if ("summary" in r) {
      acc.filesProcessed += r.summary.filesProcessed;
      acc.entriesRead += r.summary.entriesRead;
      acc.listensInserted += r.summary.listensInserted;
      acc.listensSkipped += r.summary.listensSkipped;
      acc.artistsCreated += r.summary.artistsCreated;
      acc.podcastShowsCreated += r.summary.podcastShowsCreated;
    }
    return acc;
  }, emptyTotal());

  const errors = results.flatMap((r) => {
    if ("error" in r) return [`${r.fileName}: ${r.error}`];
    return r.summary.errors.map((e) => `${r.fileName}: ${e}`);
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept="application/json"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && e.target.files.length > 0 && handleFiles(e.target.files)}
          />
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? "Importing…" : "Upload Spotify export files"}
          </Button>
          {progress && (
            <span className="text-sm text-muted-foreground">
              {progress.done} / {progress.total} files
              {currentChunk && ` (part ${currentChunk.index}/${currentChunk.total})`}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Select every{" "}
          <code className="rounded bg-muted px-1 py-0.5">Streaming_History_Audio_*.json</code> file from your
          Spotify &ldquo;Extended Streaming History&rdquo; data export. Files aren&rsquo;t stored — only the
          listens they contain are. Re-uploading a file (or an overlapping one) is safe and won&rsquo;t create
          duplicates.
        </p>

        {results.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              <div>
                <span className="text-muted-foreground">Files processed</span>
                <div className="font-mono">{total.filesProcessed}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Entries read</span>
                <div className="font-mono">{total.entriesRead}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Listens inserted</span>
                <div className="font-mono">{total.listensInserted}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Duplicates skipped</span>
                <div className="font-mono">{total.listensSkipped}</div>
              </div>
              <div>
                <span className="text-muted-foreground">New artists</span>
                <div className="font-mono">{total.artistsCreated}</div>
              </div>
              <div>
                <span className="text-muted-foreground">New podcast shows</span>
                <div className="font-mono">{total.podcastShowsCreated}</div>
              </div>
            </div>
            {errors.length > 0 && (
              <div className="flex flex-col gap-1 text-xs text-destructive">
                {errors.map((e, i) => (
                  <span key={i}>{e}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
