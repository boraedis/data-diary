import { NextResponse } from "next/server";
import { createPlaceCategory, listPlaceCategories, validateNameInput } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

// Each category comes back with its subcategories nested, same shape as
// GET /api/exercise-focuses.
export async function GET() {
  const items = await listPlaceCategories();
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
    const created = await createPlaceCategory(parsed.value.name);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
