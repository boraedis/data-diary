import { NextResponse } from "next/server";
import { lookupHudContext } from "@/lib/video-journal/hud-context";

export const dynamic = "force-dynamic";

/**
 * City/region/country and current weather for the device's coordinates,
 * for the mission HUD (#599). Called once when recording starts. Behind
 * the session gate like every non-public route (src/proxy.ts), so the
 * Google key it spends can't be used by anyone else. Either part may come
 * back null; the HUD shows what it gets.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { lat, lng } = (body ?? {}) as { lat?: unknown; lng?: unknown };
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return NextResponse.json({ error: "lat/lng must be valid coordinates" }, { status: 400 });
  }
  return NextResponse.json(await lookupHudContext(lat, lng));
}
