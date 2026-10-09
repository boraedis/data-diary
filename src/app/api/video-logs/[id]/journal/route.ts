import { NextResponse } from "next/server";
import { videoLogErrorResponse } from "@/lib/video-journal/api-errors";
import type { JournalChoice } from "@/lib/video-journal/journal-rules";
import { isVideoLogId } from "@/lib/video-journal/video-log-types";
import { resolveJournalChoice } from "@/lib/video-journal/transcription";

export const dynamic = "force-dynamic";

const CHOICES = new Set<JournalChoice>(["replace", "append", "keep"]);

/** Replace / Append / Keep for a transcript the journal didn't take
 * automatically (#341). `shownJournal` is the text the user was looking
 * at; if the journal has changed since, nothing is written (409). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isVideoLogId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { choice, shownJournal } = (body ?? {}) as { choice?: unknown; shownJournal?: unknown };
  if (typeof choice !== "string" || !CHOICES.has(choice as JournalChoice)) {
    return NextResponse.json({ error: "choice must be replace, append or keep" }, { status: 400 });
  }
  if (shownJournal !== null && typeof shownJournal !== "string") {
    return NextResponse.json({ error: "shownJournal must be text or null" }, { status: 400 });
  }

  try {
    const journal = await resolveJournalChoice(id.toLowerCase(), choice as JournalChoice, shownJournal);
    return NextResponse.json({ journal });
  } catch (error) {
    return videoLogErrorResponse(error);
  }
}
