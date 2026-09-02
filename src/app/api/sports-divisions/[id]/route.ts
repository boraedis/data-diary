import { NextResponse } from "next/server";
import {
  deleteSportsDivision,
  getSportsDivision,
  getSportsDivisionUsage,
  updateSportsDivision,
  validateNameInput,
} from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// Flat, not nested under /api/sports-leagues — matches the pattern used for
// /api/sports-seasons: creation is nested under its parent
// (POST /api/sports-leagues/[id]/divisions), but individual
// get/update/delete only need the division's own id.
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const item = await getSportsDivision(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const usage = await getSportsDivisionUsage(id);
  return NextResponse.json({ item, usage });
}

// Rename only — sportsTeams.division is a plain string (not an FK; see the
// schema comment), so renaming here does NOT retroactively update any team
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
    const updated = await updateSportsDivision(id, parsed.value.name);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A division with that name already exists in this league" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}

// Blocks if any team still carries this division's name (soft reference,
// checked at the app level — sportsTeams.division is free text).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getSportsDivisionUsage(id);
  if (usage.teamCount > 0) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteSportsDivision(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
