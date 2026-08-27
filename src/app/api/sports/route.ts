import { NextResponse } from "next/server";
import { createSport, listSportsCatalog, validateSportInput } from "@/lib/days";

export const dynamic = "force-dynamic";

// Each sport comes back with its leagues and teams nested — populates the
// manage hub and the entry form's sport -> league -> team picker cascade in
// one round trip.
export async function GET() {
  const items = await listSportsCatalog();
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateSportInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createSport(parsed.value);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
