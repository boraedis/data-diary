import { NextResponse } from "next/server";
import {
  deleteUnloggedTravel,
  listUnloggedTravel,
  upsertUnloggedTravel,
  validateUnloggedTravelInput,
  type UnloggedTravelKind,
} from "@/lib/unlogged-travel";

export const dynamic = "force-dynamic";

// CRUD for unlogged travel (#367). Same shape as the other catalog routes
// here (see api/metros): validate through the domain lib, never inline.
//
// Addressed by query string rather than a `[kind]/[code]` path segment
// pair, because the identity is the *composite* (kind, code) and a nested
// dynamic route would imply a hierarchy — /country/840 reading as "the 840
// under countries" — that doesn't exist. There's one flat table with a
// two-part key, and the query string says that honestly.

function parseKind(value: string | null): UnloggedTravelKind | null {
  return value === "us_county" || value === "country" ? value : null;
}

export async function GET(request: Request) {
  const kind = parseKind(new URL(request.url).searchParams.get("kind"));
  if (!kind) return NextResponse.json({ error: "kind must be 'us_county' or 'country'" }, { status: 400 });
  return NextResponse.json(await listUnloggedTravel(kind));
}

/** Upsert — the composite key is the identity, so creating a row that
 * already exists is an edit rather than a conflict. That's the same call
 * the seed runner makes, and it means the UI needs no separate add/edit
 * endpoints. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateUnloggedTravelInput(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    await upsertUnloggedTravel(parsed.value);
    return NextResponse.json(parsed.value);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = parseKind(params.get("kind"));
  const code = params.get("code")?.trim();
  if (!kind) return NextResponse.json({ error: "kind must be 'us_county' or 'country'" }, { status: 400 });
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  try {
    await deleteUnloggedTravel(kind, code);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
