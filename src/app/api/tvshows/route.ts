import { NextResponse } from "next/server";
import { createTvShowCatalogEntry, listTvShowsCatalog, validateTvShowCatalogRequest } from "@/lib/days";
import { getTvShowDetails } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await listTvShowsCatalog();
  return NextResponse.json(items);
}

/** Same shape as POST /api/movies — the client only ever sends a tmdbId,
 * the rest of the catalog row is fetched server-side from TMDB and upserted
 * here. A brand-new show starts `interested: true` (see
 * createTvShowCatalogEntry in src/lib/days.ts). */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateTvShowCatalogRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const details = await getTvShowDetails(parsed.value.tmdbId);
    const created = await createTvShowCatalogEntry(details);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
