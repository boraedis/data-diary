import { NextResponse } from "next/server";
import { deleteGameCatalogEntry, getGameCatalogEntry, getGameUsage, updateGameCatalogEntry, validateGameInput } from "@/lib/days";

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

  const item = await getGameCatalogEntry(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const usage = await getGameUsage(id);
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

  const parsed = validateGameInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const updated = await updateGameCatalogEntry(id, parsed.value);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A game with that name already exists" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}

// Only blocked by sessionCount (gameSessions.gameId is onDelete: "restrict").
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getGameUsage(id);
  if (usage.sessionCount > 0) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteGameCatalogEntry(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
