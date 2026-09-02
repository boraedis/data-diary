import { NextResponse } from "next/server";
import { getProjectSettings, upsertProjectSettings, validateProjectSettingsInput } from "@/lib/project";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getProjectSettings();
  return NextResponse.json(settings);
}

// Single-row upsert (see the `projectSettings` table comment) — a plain PUT
// rather than POST/PATCH, same reasoning as /api/profile/settings.
export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateProjectSettingsInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const updated = await upsertProjectSettings(parsed.value);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
