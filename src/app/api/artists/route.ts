import { NextResponse } from "next/server";
import { listArtists } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// No POST — artist rows are only ever created by the Spotify import
// pipeline (src/lib/music-import.ts), never hand-typed here.
export async function GET() {
  const items = await listArtists();
  return NextResponse.json(items);
}
