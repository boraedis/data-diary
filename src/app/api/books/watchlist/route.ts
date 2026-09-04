import { NextResponse } from "next/server";
import { addToBookWatchlist, getBookCatalogEntry, listBookWatchlist } from "@/lib/days";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listBookWatchlist();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bookId = (body as { bookId?: unknown } | null)?.bookId;
  if (typeof bookId !== "number" || !Number.isInteger(bookId)) {
    return NextResponse.json({ error: "bookId is required" }, { status: 400 });
  }

  const book = await getBookCatalogEntry(bookId);
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  await addToBookWatchlist(bookId);
  return NextResponse.json({ ok: true });
}
