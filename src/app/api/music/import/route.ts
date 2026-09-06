import { NextResponse } from "next/server";
import { importSpotifyExport } from "@/lib/music-import";

export const dynamic = "force-dynamic";
// A single historical export file can take a while once it's resolving
// dozens of never-seen artists through the Spotify API (one request per
// new artist, see src/lib/spotify.ts) — well past Vercel's default 10s.
export const maxDuration = 300;

// One entry-array slice per request, not a whole file — Vercel Functions
// hard-cap request bodies at 4.5MB (vercel.com/docs/functions/limitations
// #request-body-size), and Spotify's own export splitting produces files
// well above that (~12MB observed, see #192). The client (music-upload-
// panel.tsx) reads and JSON.parses each file itself so it can split one
// big file into several requests sized to stay under that limit, merging
// the per-slice summaries back into one result per original file.
//
// Nothing here is written to disk or any storage layer — entries are held
// in memory just long enough to extract the fields importSpotifyExport
// writes to musicListens. See that table's comment in schema.ts for why.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, entries } = (body ?? {}) as { name?: unknown; entries?: unknown };
  if (typeof name !== "string" || !Array.isArray(entries)) {
    return NextResponse.json({ error: "Expected { name: string, entries: array }" }, { status: 400 });
  }

  try {
    const summary = await importSpotifyExport([{ name, entries }]);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
