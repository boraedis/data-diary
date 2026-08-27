import { NextResponse } from "next/server";
import { createExerciseSubtype, listExerciseSubtypes, validateExerciseSubtypeInput } from "@/lib/catalog-admin";
import type { ExerciseCategory } from "@/db/schema";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = new Set<string>(["distance", "sport", "strength"] satisfies ExerciseCategory[]);

// ?category=distance|sport|strength scopes the list — the workout entry
// form's subtype dropdown only wants the current exercise's category.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  if (category !== null && !VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  const items = await listExerciseSubtypes(category as ExerciseCategory | undefined);
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateExerciseSubtypeInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createExerciseSubtype(parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
