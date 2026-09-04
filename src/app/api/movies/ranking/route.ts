import { NextResponse } from "next/server";
import { listMovieRanking, setMovieRanking } from "@/lib/days";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listMovieRanking();
  return NextResponse.json(items);
}

// Full replace, not a patch — the client always sends the complete ordered
// list (see setMovieRanking's own comment for why rank has no meaningful
// partial update).
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const movieIds = (body as { movieIds?: unknown } | null)?.movieIds;
  if (!Array.isArray(movieIds) || !movieIds.every((id) => typeof id === "number" && Number.isInteger(id))) {
    return NextResponse.json({ error: "movieIds must be an array of integers" }, { status: 400 });
  }

  try {
    await setMovieRanking(movieIds);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
  }
}
