import { NextResponse } from "next/server";
import { addCityNeighborhoodOverride, removeCityNeighborhoodOverride } from "@/lib/city-heatmap-qa";
import { CITIES, type CityKey } from "@/lib/geo/city-config";

export const dynamic = "force-dynamic";

async function parseBody(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: "Invalid JSON" } as const;
  }
  const { cityKey, root, rawName, geometryName } = (body ?? {}) as Record<string, unknown>;
  if (typeof cityKey !== "string" || !(cityKey in CITIES) || typeof root !== "string" || typeof rawName !== "string") {
    return { error: "cityKey, root and rawName are required" } as const;
  }
  return {
    cityKey: cityKey as CityKey,
    root,
    rawName,
    geometryName: typeof geometryName === "string" ? geometryName : null,
  } as const;
}

// Adds (or re-points) a DB-backed neighborhood alias from the QA modal
// (#293) — see cityNeighborhoodOverrides.
export async function POST(request: Request) {
  const parsed = await parseBody(request);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!parsed.geometryName) return NextResponse.json({ error: "geometryName is required" }, { status: 400 });
  const result = await addCityNeighborhoodOverride({ ...parsed, geometryName: parsed.geometryName });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const parsed = await parseBody(request);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  await removeCityNeighborhoodOverride(parsed);
  return NextResponse.json({ ok: true });
}
