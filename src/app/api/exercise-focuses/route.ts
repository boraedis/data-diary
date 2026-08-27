import { NextResponse } from "next/server";
import { createExerciseFocus, listExerciseFocuses, validateNameInput } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// Each focus comes back with its subfocuses nested — the whole point of
// this endpoint is populating a two-level focus/subfocus picker in one
// round trip.
export async function GET() {
  const items = await listExerciseFocuses();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
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
    const created = await createExerciseFocus(parsed.value.name);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
