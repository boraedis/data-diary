import { NextResponse } from "next/server";
import { getTvShowCatalogEntry } from "@/lib/days";
import { getTvShowSeasons } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Just the season list (number, name, episode count) — powers the season
// picker in the "log an episode" flow before any one season's full
// episode list is fetched (see /api/tvshows/[id]/seasons/[season]/episodes).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const show = await getTvShowCatalogEntry(id);
  if (!show) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const seasons = await getTvShowSeasons(show.tmdbId);
    return NextResponse.json(seasons);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
