import { NextResponse } from "next/server";
import { createSavedColor, listSavedColors, validateSavedColorInput } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listSavedColors();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateSavedColorInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createSavedColor(parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
