import { NextResponse } from "next/server";
import { listGenres } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// No POST — genre rows are only ever created by the Spotify import
// pipeline (src/lib/music-import.ts), never hand-typed here.
export async function GET() {
  const items = await listGenres();
  return NextResponse.json(items);
}
