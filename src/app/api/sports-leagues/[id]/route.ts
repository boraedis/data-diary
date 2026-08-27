import { NextResponse } from "next/server";
import {
  deleteSportsLeague,
  getSportsLeague,
  getSportsLeagueUsage,
  updateSportsLeague,
  validateSportsLeagueInput,
} from "@/lib/days";

export const dynamic = "force-dynamic";

// Flat, not nested under /api/sports — matches the pattern used for
// /api/place-subcategories: creation is nested under its parent
// (POST /api/sports/[id]/leagues), but individual get/update/delete only
// need the league's own id.
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const item = await getSportsLeague(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const usage = await getSportsLeagueUsage(id);
  return NextResponse.json({ item, usage });
}

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

  const parsed = validateSportsLeagueInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const updated = await updateSportsLeague(id, parsed.value);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A league with that name already exists for this sport" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}

// Never blocked — sportsTeams.leagueId and sportsWatches.leagueId are both
// onDelete: "set null", so the DB lets this through regardless. `usage` is
// returned for the client to show a heads-up, not to gate the delete.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await deleteSportsLeague(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
