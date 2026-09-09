import { NextResponse } from "next/server";
import { addArtistGenre, getGenre, validateArtistGenreInput } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Attaches an existing genre-catalog row to an artist (#248) — the manual
// counterpart to the Spotify import pipeline's automatic genre resolution.
// Only ever links a genre that already exists (see validateArtistGenreInput);
// there's no way to create a new genre row from here.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const artistId = parseId((await params).id);
  if (artistId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateArtistGenreInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const genre = await getGenre(parsed.value.genreId);
  if (!genre) {
    return NextResponse.json({ error: "Genre not found" }, { status: 404 });
  }

  try {
    await addArtistGenre(artistId, genre.id);
    return NextResponse.json(genre);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
