import { NextResponse } from "next/server";
import { removeArtistGenre } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Detaches a genre from an artist (#248) — not a delete of the genre
// catalog row itself, just this artist's link to it.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; genreId: string }> }) {
  const { id: rawId, genreId: rawGenreId } = await params;
  const artistId = parseId(rawId);
  const genreId = parseId(rawGenreId);
  if (artistId === null || genreId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await removeArtistGenre(artistId, genreId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
