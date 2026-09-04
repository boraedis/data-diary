import { NextResponse } from "next/server";
import { removeFromMovieWatchlist } from "@/lib/days";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function DELETE(request: Request, { params }: { params: Promise<{ movieId: string }> }) {
  const movieId = parseId((await params).movieId);
  if (movieId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await removeFromMovieWatchlist(movieId);
  return NextResponse.json({ ok: true });
}
