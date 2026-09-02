import { NextResponse } from "next/server";
import {
  deleteSportsSeason,
  getSportsSeason,
  getSportsSeasonUsage,
  updateSportsSeason,
  validateNameInput,
} from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// Flat, not nested under /api/sports-leagues — matches the pattern used for
// /api/sleep-location-subtypes: creation is nested under its parent
// (POST /api/sports-leagues/[id]/seasons), but individual get/update/delete
// only need the season's own id.
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const item = await getSportsSeason(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const usage = await getSportsSeasonUsage(id);
  return NextResponse.json({ item, usage });
}

// Rename only — sportsWatches.season is a plain string (not an FK; see the
// schema comment), so renaming here does NOT retroactively update any watch
// that already has the old string stored.
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

  const parsed = validateNameInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const updated = await updateSportsSeason(id, parsed.value.name);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A season with that name already exists in this league" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}

// Blocks if any watch still carries this season's name (soft reference,
// checked at the app level — sportsWatches.season is free text).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getSportsSeasonUsage(id);
  if (usage.watchCount > 0) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteSportsSeason(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
