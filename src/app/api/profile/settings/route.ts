import { NextResponse } from "next/server";
import { getProfileSettings, upsertProfileSettings, validateProfileSettingsInput } from "@/lib/profile";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getProfileSettings();
  return NextResponse.json(settings);
}

// Single-row upsert (see the `profileSettings` table comment) — a plain
// PUT rather than POST/PATCH since there's nothing to create vs. update,
// just one record that always exists in effect.
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateProfileSettingsInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const updated = await upsertProfileSettings(parsed.value);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
