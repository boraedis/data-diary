import { NextResponse } from "next/server";
import { createProfileRelationship, listProfileRelationships, validateProfileRelationshipInput } from "@/lib/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listProfileRelationships();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateProfileRelationshipInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createProfileRelationship(parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
