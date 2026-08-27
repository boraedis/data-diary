import { NextResponse } from "next/server";
import { addExerciseFocusLink, listExerciseFocusLinks, validateExerciseFocusLinkInput } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// An exercise's focus/subfocus tags — legacy stored these as an array on
// the exercise doc; here it's a many-to-many join table (exercise can have
// more than one focus/subfocus pair).
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const exerciseId = parseId((await params).id);
  if (exerciseId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const links = await listExerciseFocusLinks(exerciseId);
  return NextResponse.json(links);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const exerciseId = parseId((await params).id);
  if (exerciseId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateExerciseFocusLinkInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await addExerciseFocusLink(exerciseId, parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
