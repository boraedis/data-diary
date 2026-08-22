import { NextResponse } from "next/server";
import { createPersonCatalogEntry, listPeopleCatalog, validateCatalogName } from "@/lib/days";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listPeopleCatalog();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateCatalogName(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createPersonCatalogEntry(parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
