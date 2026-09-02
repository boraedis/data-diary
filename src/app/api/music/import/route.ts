import { NextResponse } from "next/server";
import { importSpotifyExport } from "@/lib/music-import";

export const dynamic = "force-dynamic";
// A single historical export file can take a while once it's resolving
// dozens of never-seen artists through the Spotify API (one request per
// new artist, see src/lib/spotify.ts) — well past Vercel's default 10s.
export const maxDuration = 300;

// One file per request, not a batch — the client (src/app/manage/
// entertainment/music/page.tsx) uploads a multi-file selection as
// sequential requests instead. Spotify's own export already splits large
// account histories into several files; keeping each request to one of
// them keeps the request body well under typical serverless body-size
// limits and means a failure partway through a big backlog only has to be
// retried for the one file that failed, not the whole upload.
//
// The uploaded file is read into memory (`file.text()`) and handed
// straight to importSpotifyExport — never written to disk or any storage
// layer. See the `musicListens` table comment in schema.ts for why.
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const text = await file.text();

  try {
    const summary = await importSpotifyExport([{ name: file.name, text }]);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed" },
      { status: 500 }
    );
  }
}
