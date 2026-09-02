import { NextResponse } from "next/server";
import {
  deleteGameSubcategory,
  getGameSubcategory,
  getGameSubcategoryUsage,
  updateGameSubcategory,
  validateNameInput,
} from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// Flat, not nested under /api/game-categories — matches the pattern used
// for /api/place-subcategories: creation is nested under its parent
// (POST /api/game-categories/[id]/subcategories), but individual
// get/update/delete only need the subcategory's own id.
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const item = await getGameSubcategory(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const usage = await getGameSubcategoryUsage(id);
  return NextResponse.json({ item, usage });
}

// Rename only — the subcategory stays under its original category; moving
// it to a different category isn't supported here (mirrors place
// subcategories' own PATCH).
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
    const updated = await updateGameSubcategory(id, parsed.value.name);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A subcategory with that name already exists in this category" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}

// Blocks if any game still carries this subcategory's name (soft
// reference, checked at the app level — games.subtype is free text).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getGameSubcategoryUsage(id);
  if (usage.gameCount > 0) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteGameSubcategory(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
