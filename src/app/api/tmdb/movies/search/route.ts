import { NextResponse } from "next/server";
import { searchMovies } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

// Thin proxy in front of TMDB's search endpoint — exists purely so the API
// key (src/lib/tmdb.ts) never has to reach the browser. Powers the debounced
// live-search box in the "+ Add from TMDB" flow (see
// components/entry-forms/movie-entry-form.tsx).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  if (!query.trim()) {
    return NextResponse.json([]);
  }

  try {
    const results = await searchMovies(query);
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "TMDB search failed" },
      { status: 502 }
    );
  }
}
