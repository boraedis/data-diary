import { NextResponse } from "next/server";
import { getCityPlaceQaReport } from "@/lib/city-heatmap-qa";
import { CITIES, type CityKey } from "@/lib/geo/city-config";

export const dynamic = "force-dynamic";

// The QA modal's read: every open/dismissed finding for one city, plus
// its overrides and polygon names (#293). Behind the session gate like
// every other non-public /api route — see src/proxy.ts.
export async function GET(request: Request) {
  const city = new URL(request.url).searchParams.get("city");
  if (!city || !(city in CITIES)) {
    return NextResponse.json({ error: "Unknown or missing city" }, { status: 400 });
  }
  return NextResponse.json(await getCityPlaceQaReport(city as CityKey));
}
