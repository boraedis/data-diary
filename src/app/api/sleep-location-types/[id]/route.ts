import { NextResponse } from "next/server";
import {
  deleteSleepLocationType,
  getSleepLocationType,
  getSleepLocationTypeUsage,
  updateSleepLocationType,
  validateNameInput,
} from "@/lib/catalog-admin";

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

  const item = await getSleepLocationType(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const usage = await getSleepLocationTypeUsage(id);
  return NextResponse.json({ item, usage });
}

// Rename — days.sleepLocationType is a plain string (not an FK; see the
// schema comment), so renaming here does NOT retroactively update any day
// that already has the old string stored in its `sleepLocationType` field.
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
    const updated = await updateSleepLocationType(id, parsed.value.name);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A location type with that name already exists" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}

// Blocks if any day still carries this type's name (soft reference, checked
// at the app level) or any subtype still belongs to it
// (sleepLocationSubtypes.typeId is a real FK, onDelete: "restrict" — the DB
// would refuse this delete on its own if that count is nonzero).
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getSleepLocationTypeUsage(id);
  if (usage.dayCount > 0 || usage.subtypeCount > 0) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteSleepLocationType(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
