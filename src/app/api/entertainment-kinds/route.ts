import { NextResponse } from "next/server";
import {
  createEntertainmentKindEntry,
  listEntertainmentKinds,
  validateEntertainmentKindInput,
} from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listEntertainmentKinds();
  return NextResponse.json(items);
}

// Always creates a custom (isSystem: false) kind — there's no flow that
// adds a new system kind after the one-time seed (see
// scripts/migrate-entertainment-kinds.mjs).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateEntertainmentKindInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createEntertainmentKindEntry(parsed.value.name);
    return NextResponse.json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A kind with that name already exists" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}
