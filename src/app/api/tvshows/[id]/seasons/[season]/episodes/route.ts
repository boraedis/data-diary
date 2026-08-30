import { NextResponse } from "next/server";
import { getTvShowCatalogEntry, syncTvShowSeasonEpisodes } from "@/lib/days";
import { getSeasonEpisodes } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Fetches this season's episodes from TMDB, upserts them into the local
// tvEpisodes catalog (so their ids are stable and log-able), and returns
// each one alongside its own logged watches — see
// syncTvShowSeasonEpisodes in src/lib/days.ts. Called every time the
// season is opened in the UI, not cached beyond that; TMDB's episode list
// for an already-aired season basically never changes, so this is a
// correctness-over-cleverness call for a personal app's request volume.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; season: string }> }
) {
  const { id: rawId, season: rawSeason } = await params;
  const id = parseId(rawId);
  const season = parseId(rawSeason);
  if (id === null || season === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const show = await getTvShowCatalogEntry(id);
  if (!show) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const remoteEpisodes = await getSeasonEpisodes(show.tmdbId, season);
    const episodes = await syncTvShowSeasonEpisodes(id, remoteEpisodes);
    return NextResponse.json(episodes);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
