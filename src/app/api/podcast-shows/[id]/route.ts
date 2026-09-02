import { NextResponse } from "next/server";
import { updatePodcastShowCategory } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// The only editable field on a podcast show is which category it belongs
// to — see the `podcastShows` table comment in schema.ts.
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
  if (b.categoryId !== null && typeof b.categoryId !== "number") {
    return NextResponse.json({ error: "categoryId must be a number or null" }, { status: 400 });
  }

  try {
    const updated = await updatePodcastShowCategory(id, b.categoryId);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
