import { NextResponse } from "next/server";
import { listPodcastShows } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// No POST — podcast show rows are only ever created by the Spotify import
// pipeline (src/lib/music-import.ts), never hand-typed here.
export async function GET() {
  const items = await listPodcastShows();
  return NextResponse.json(items);
}
