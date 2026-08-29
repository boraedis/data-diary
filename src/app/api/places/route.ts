import { NextResponse } from "next/server";
import { createPlaceCatalogEntry, listPlacesCatalog, validatePlaceCatalogEntry } from "@/lib/days";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listPlacesCatalog();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validatePlaceCatalogEntry(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createPlaceCatalogEntry(parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    // createPlaceCatalogEntry throws a plain Error for the root-category
    // guard (assertValidRoot in src/lib/days.ts) — a bad request, not a
    // server fault, so 400 rather than 500 (mirrors the PATCH route below).
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 400 }
    );
  }
}
