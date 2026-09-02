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

// Uploads Spotify "Extended Streaming History" export files one request per
// file (see the route's own comment for why: it keeps each request body
// small and means a failure only has to be retried for the file that
// failed). The files themselves never leave this request cycle — read into
// memory here, sent as multipart form data, parsed and discarded server-side.
export function MusicUploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);

  async function handleFiles(files: FileList) {
    setUploading(true);
    setResults([]);
    const list = Array.from(files);
    setProgress({ done: 0, total: list.length });
    const collected: FileResult[] = [];

    for (const file of list) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch("/api/music/import", { method: "POST", body: formData });
        const body = await res.json();
        if (!res.ok) {
          collected.push({ fileName: file.name, error: typeof body?.error === "string" ? body.error : "Import failed" });
        } else {
          collected.push({ fileName: file.name, summary: body as MusicImportSummary });
        }
      } catch {
        collected.push({ fileName: file.name, error: "Network error" });
      }
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
