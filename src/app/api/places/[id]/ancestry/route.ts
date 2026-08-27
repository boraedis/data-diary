import { NextResponse } from "next/server";
import { getPlaceAncestry } from "@/lib/days";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Root-to-self ancestor chain — replaces legacy's maintained `world` tree
// path with a walk-up-on-read (see getPlaceAncestry in src/lib/days.ts).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const ancestry = await getPlaceAncestry(id);
  if (ancestry.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(ancestry);
}
