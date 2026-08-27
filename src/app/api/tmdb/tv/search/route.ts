import { NextResponse } from "next/server";
import { searchTvShows } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

// Thin proxy in front of TMDB's TV search endpoint, same reasoning as
// api/tmdb/movies/search/route.ts — keeps the API key server-side. Powers
// the debounced live-search box in TmdbTvSearchModal.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  if (!query.trim()) {
    return NextResponse.json([]);
  }

  try {
    const results = await searchTvShows(query);
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TMDB search failed" },
      { status: 502 }
    );
  }
}
