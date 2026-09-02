import { NextResponse } from "next/server";
import { getPublicLandingData } from "@/lib/public-profile";

// The only read endpoint proxy.ts's isPublic check allows through without a
// session (see the `/api/public/` prefix there) — everything it returns is
// already curated/masked by getPublicLandingData, so no auth check is
// needed here.
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getPublicLandingData();
  return NextResponse.json(data);
}
