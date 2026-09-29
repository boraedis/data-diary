import { NextResponse } from "next/server";
import { describeQaFailure, dismissCityPlaceQaFinding, undismissCityPlaceQaFinding } from "@/lib/city-heatmap-qa";
import { parseCityPlaceQaKind } from "@/lib/geo/city-place-qa";

export const dynamic = "force-dynamic";

async function parseBody(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: "Invalid JSON" } as const;
  }
  const { placeId, kind } = (body ?? {}) as { placeId?: unknown; kind?: unknown };
  const parsedKind = parseCityPlaceQaKind(kind);
  if (typeof placeId !== "number" || !Number.isInteger(placeId) || !parsedKind) {
    return { error: "placeId (integer) and a valid kind are required" } as const;
  }
  return { placeId, kind: parsedKind } as const;
}

// "Dismiss as intended" (#293) — idempotent; see cityPlaceQaDismissals.
export async function POST(request: Request) {
  const parsed = await parseBody(request);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    await dismissCityPlaceQaFinding(parsed.placeId, parsed.kind);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("city-heatmap-qa dismiss failed", err);
    const failure = describeQaFailure(err);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}

export async function DELETE(request: Request) {
  const parsed = await parseBody(request);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    await undismissCityPlaceQaFinding(parsed.placeId, parsed.kind);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("city-heatmap-qa undismiss failed", err);
    const failure = describeQaFailure(err);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
