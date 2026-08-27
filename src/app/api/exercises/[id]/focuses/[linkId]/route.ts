import { NextResponse } from "next/server";
import { removeExerciseFocusLink } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Removes one focus/subfocus tag from an exercise — not a delete of the
// focus/subfocus catalog entries themselves, just this exercise's link to
// one.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { linkId: rawLinkId } = await params;
  const linkId = parseId(rawLinkId);
  if (linkId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await removeExerciseFocusLink(linkId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
