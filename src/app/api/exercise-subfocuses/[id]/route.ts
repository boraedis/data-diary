import { NextResponse } from "next/server";
import {
  deleteExerciseSubfocus,
  getExerciseSubfocus,
  getExerciseSubfocusUsage,
  updateExerciseSubfocus,
  validateExerciseSubfocusInput,
} from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// Flat, not nested under /api/exercise-focuses — matches the pattern used
// for /api/place-subcategories: creation is nested under its parent
// (POST /api/exercise-focuses/[id]/subfocuses), but individual
// get/update/delete only need the subfocus's own id, and update can move a
// subfocus to a different focus (unlike place subcategories).
function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const item = await getExerciseSubfocus(id);
  if (!item) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const usage = await getExerciseSubfocusUsage(id);
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

  const parsed = validateExerciseSubfocusInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const updated = await updateExerciseSubfocus(id, parsed.value);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A subfocus with that name already exists under this focus" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}

// Blocks if any exercise is still linked via this subfocus — a real
// DB-level FK, exerciseFocusLinks.subfocusId is onDelete: "restrict".
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (id === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const usage = await getExerciseSubfocusUsage(id);
  if (usage.linkCount > 0) {
    return NextResponse.json({ error: "Still in use", usage }, { status: 409 });
  }

  try {
    await deleteExerciseSubfocus(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
