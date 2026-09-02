import { NextResponse } from "next/server";
import { updateGenreGroupAssignment } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// The only editable field on a genre is which broad group it belongs to —
// see the `genres` table comment in schema.ts.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  if (b.groupId !== null && typeof b.groupId !== "number") {
    return NextResponse.json({ error: "groupId must be a number or null" }, { status: 400 });
  }

  try {
    const updated = await updateGenreGroupAssignment(id, b.groupId);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
