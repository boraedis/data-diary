import { NextResponse } from "next/server";
import { removeFromBookWatchlist } from "@/lib/days";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function DELETE(request: Request, { params }: { params: Promise<{ bookId: string }> }) {
  const bookId = parseId((await params).bookId);
  if (bookId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await removeFromBookWatchlist(bookId);
  return NextResponse.json({ ok: true });
}
