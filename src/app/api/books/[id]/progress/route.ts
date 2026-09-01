import { NextResponse } from "next/server";
import { getBookProgress } from "@/lib/days";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Read-only lookup for the day-entry book picker (issue #61): the computed
// bookmark (see the `books` table comment in schema.ts — deliberately not
// stored, derived from session history) prefills Start Page the moment a
// book with no session logged yet today is picked.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const progress = await getBookProgress(id);
  return NextResponse.json(progress);
}
