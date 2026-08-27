import { NextResponse } from "next/server";
import { getPlaceChildren } from "@/lib/days";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Direct children only (not the full subtree) — the hierarchy browser
// drills down one level at a time, same as legacy's world.js Miller-columns
// UI, just against `parentId` instead of a maintained nested map.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const children = await getPlaceChildren(id);
  return NextResponse.json(children);
}
