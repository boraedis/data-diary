import { NextResponse } from "next/server";
import { createTag, listTags, validateTagInput } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listTags();
  return NextResponse.json(items);
}

// Unlike every other catalog's create function, this does NOT silently
// reuse an existing row on a name collision — legacy's create-tag did
// exactly that (a real bug: retyping an existing tag's name silently
// overwrote its color), so a duplicate name here fails loudly with a 409
// instead.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateTagInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createTag(parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.toLowerCase().includes("unique") || message.toLowerCase().includes("duplicate");
    return NextResponse.json(
      { error: isDuplicate ? "A tag with that name already exists" : message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}
