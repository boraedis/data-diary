import { NextResponse } from "next/server";
import { addToMovieWatchlist, getMovieCatalogEntry, listMovieWatchlist } from "@/lib/days";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listMovieWatchlist();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const movieId = (body as { movieId?: unknown } | null)?.movieId;
  if (typeof movieId !== "number" || !Number.isInteger(movieId)) {
    return NextResponse.json({ error: "movieId is required" }, { status: 400 });
  }

  const movie = await getMovieCatalogEntry(movieId);
  if (!movie) {
    return NextResponse.json({ error: "Movie not found" }, { status: 404 });
  }

  await addToMovieWatchlist(movieId);
  return NextResponse.json({ ok: true });
}
