import { NextResponse } from "next/server";
import { addProfileOccupationRole, getProfileOccupation, validateProfileOccupationRoleInput } from "@/lib/profile";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// Adds one role (a promotion/title-change) to an existing occupation entry
// — see the `profileOccupationRoles` table comment. Roles are otherwise
// managed through /api/profile/occupation-roles/[id] (PATCH/DELETE), not
// through this occupation-scoped path, once they exist.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const occupationId = parseId((await params).id);
  if (occupationId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const occupation = await getProfileOccupation(occupationId);
  if (!occupation) {
    return NextResponse.json({ error: "Occupation not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateProfileOccupationRoleInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await addProfileOccupationRole(occupationId, parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
