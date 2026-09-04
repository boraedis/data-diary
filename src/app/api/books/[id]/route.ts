import { NextResponse } from "next/server";
import { deleteBookCatalogEntry, getBookCatalogEntry, getBookProgress, getBookUsage } from "@/lib/days";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// No PATCH here — a book's fields are all Google Books metadata (see
// src/lib/google-books.ts), not hand-edited. GET/DELETE only.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const item = await getBookCatalogEntry(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [usage, progress] = await Promise.all([getBookUsage(id), getBookProgress(id)]);
  return NextResponse.json({ item, usage, progress });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getBookUsage(id);
  if (usage.sessions.length > 0 || usage.onWatchlist || usage.rank !== null) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteBookCatalogEntry(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
