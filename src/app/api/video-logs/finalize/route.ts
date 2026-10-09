import { NextResponse } from "next/server";
import { isValidDateString } from "@/lib/date";
import { r2NotConfiguredResponse, videoLogErrorResponse } from "@/lib/video-journal/api-errors";
import { finalizeDay } from "@/lib/video-journal/finalize";
import type { JournalChoice } from "@/lib/video-journal/journal-rules";
import { isVideoLogId } from "@/lib/video-journal/video-log-types";

export const dynamic = "force-dynamic";

const CHOICES = new Set<JournalChoice>(["replace", "append", "keep"]);

/**
 * Finalize a day's recordings (#613): put the chosen recording's log block
 * in the journal and permanently delete the day's other recordings. Answers
 * `{ status: "needs-choice" }` without changing anything when the journal
 * holds writing and no `choice` was given. `shownJournal` is the journal
 * text the page was showing; if it's out of date, nothing is changed (409).
 * Needs R2 (503 without it), since finalizing deletes from it.
 */
export async function POST(request: Request) {
  const notConfigured = r2NotConfiguredResponse();
  if (notConfigured) return notConfigured;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { date, primaryId, choice, shownJournal } = (body ?? {}) as Record<string, unknown>;
  if (typeof date !== "string" || !isValidDateString(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }
  if (!isVideoLogId(primaryId)) return NextResponse.json({ error: "Invalid primaryId" }, { status: 400 });
  if (choice !== undefined && choice !== null && !(typeof choice === "string" && CHOICES.has(choice as JournalChoice))) {
    return NextResponse.json({ error: "choice must be replace, append or keep" }, { status: 400 });
  }
  if (shownJournal !== null && typeof shownJournal !== "string") {
    return NextResponse.json({ error: "shownJournal must be text or null" }, { status: 400 });
  }

  try {
    const result = await finalizeDay({
      date,
      primaryId: primaryId.toLowerCase(),
      choice: (choice as JournalChoice | null | undefined) ?? null,
      shownJournal,
    });
    return NextResponse.json(result);
  } catch (error) {
    return videoLogErrorResponse(error);
  }
}
