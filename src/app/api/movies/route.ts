import { NextResponse } from "next/server";
import { createMovieCatalogEntry, listMoviesCatalog, validateMovieCatalogRequest } from "@/lib/days";
import { getMovieDetails } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listMoviesCatalog();
  return NextResponse.json(items);
}

/** Unlike places/people (manual field entry), a new movie only needs a
 * tmdbId from the client — the rest of the catalog row (title, runtime,
 * genres, poster, collection) is fetched server-side from TMDB and upserted
 * here, so the client never has to duplicate or fake that metadata, and the
 * API key never leaves the server. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateMovieCatalogRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const details = await getMovieDetails(parsed.value.tmdbId);
    const created = await createMovieCatalogEntry(details);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
