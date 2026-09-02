import { NextResponse } from "next/server";
import { createGenreGroup, listGenreGroups, validateGenreGroupInput } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listGenreGroups();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateGenreGroupInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createGenreGroup(parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A genre group with that name already exists" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}
