import { NextResponse } from "next/server";
import {
  deleteSleepLocationSubtype,
  getSleepLocationSubtype,
  getSleepLocationSubtypeUsage,
  updateSleepLocationSubtype,
  validateNameInput,
} from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// Flat, not nested under /api/sleep-location-types — matches the pattern
// used for /api/place-subcategories: creation is nested under its parent
// (POST /api/sleep-location-types/[id]/subtypes), but individual
// get/update/delete only need the subtype's own id.
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const item = await getSleepLocationSubtype(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const usage = await getSleepLocationSubtypeUsage(id);
  return NextResponse.json({ item, usage });
}

// Rename only — the subtype stays under its original type; moving it to a
// different type isn't supported here (mirrors place-subcategories).
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
    const updated = await updateSleepLocationSubtype(id, parsed.value.name);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A subtype with that name already exists in this type" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}

// Blocks if any day still carries this subtype's name (soft reference,
// checked at the app level — days.sleepLocationSubtype is free text).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getSleepLocationSubtypeUsage(id);
  if (usage.dayCount > 0) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteSleepLocationSubtype(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
