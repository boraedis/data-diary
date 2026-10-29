import { NextResponse } from "next/server";
import { getTvShowCatalogEntry, refreshTvShowCatalogEntry } from "@/lib/days";
import { syncAllTvShowEpisodes } from "@/lib/tv-episode-catalog";
import { getTvShowDetails } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Kept separate from the interested-toggle PATCH above so each route stays
// narrow: this one re-fetches everything TMDB-sourced (status, next
// episode, poster, genres, title) and never touches interested/
// uninterestedDate — see refreshTvShowCatalogEntry in src/lib/days.ts. It
// also re-syncs every season's episodes, since a refresh is how a newly
// announced season reaches the TV backlog.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const existing = await getTvShowCatalogEntry(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const details = await getTvShowDetails(existing.tmdbId);
    const updated = await refreshTvShowCatalogEntry(id, details);
    await syncAllTvShowEpisodes(id, existing.tmdbId);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
