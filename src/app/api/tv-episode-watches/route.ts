import { NextResponse } from "next/server";
import { createTvEpisodeWatch, validateTvEpisodeWatchInput } from "@/lib/days";

export const dynamic = "force-dynamic";

// episodeId isn't part of validateTvEpisodeWatchInput (date/locationType
// only) since every other catalog's create route validates its own
// required foreign key the same way — see e.g. validateSportsTeamInput,
// which leaves sportId to its route param instead of the body validator.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const episodeId = typeof b.episodeId === "number" ? b.episodeId : NaN;
  if (!Number.isInteger(episodeId)) {
    return NextResponse.json({ error: "Invalid episodeId" }, { status: 400 });
  }

  const parsed = validateTvEpisodeWatchInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const created = await createTvEpisodeWatch(episodeId, parsed.value.date, parsed.value.locationType);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
