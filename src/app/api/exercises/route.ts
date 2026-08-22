import { NextResponse } from "next/server";
import { createExerciseCatalogEntry, listExercisesCatalog, validateExerciseCatalogEntry } from "@/lib/days";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listExercisesCatalog();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateExerciseCatalogEntry(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createExerciseCatalogEntry(parsed.value.name, parsed.value.category);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
