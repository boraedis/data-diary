import { NextResponse } from "next/server";
import { deleteTvShowCatalogEntry, getTvShowCatalogEntry, getTvShowUsage, updateTvShowInterested } from "@/lib/days";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const item = await getTvShowCatalogEntry(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const usage = await getTvShowUsage(id);
  return NextResponse.json({ item, usage });
}

// Narrow on purpose, unlike people/places/exercises/entertainment's
// full-field PATCH — a TV show's only hand-editable field is whether you're
// still tracking it (see updateTvShowInterested in src/lib/days.ts). Every
// other field is TMDB metadata, refreshed via POST
// /api/tvshows/[id]/refresh instead.
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
  if (typeof b.interested !== "boolean") {
    return NextResponse.json({ error: "interested must be a boolean" }, { status: 400 });
  }

  try {
    const updated = await updateTvShowInterested(id, b.interested);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getTvShowUsage(id);
  if (usage.watchCount > 0) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteTvShowCatalogEntry(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
