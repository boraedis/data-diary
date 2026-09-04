import { NextResponse } from "next/server";
import { listBookRanking, setBookRanking } from "@/lib/days";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listBookRanking();
  return NextResponse.json(items);
}

// Full replace — see setBookRanking's own comment for why.
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bookIds = (body as { bookIds?: unknown } | null)?.bookIds;
  if (!Array.isArray(bookIds) || !bookIds.every((id) => typeof id === "number" && Number.isInteger(id))) {
    return NextResponse.json({ error: "bookIds must be an array of integers" }, { status: 400 });
  }

  try {
    await setBookRanking(bookIds);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 400 });
  }
}
