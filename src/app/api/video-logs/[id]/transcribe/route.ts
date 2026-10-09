import { after, NextResponse } from "next/server";
import { videoLogErrorResponse } from "@/lib/video-journal/api-errors";
import { isVideoLogId } from "@/lib/video-journal/video-log-types";
import { claimTranscription, isTranscriptionConfigured, runTranscription } from "@/lib/video-journal/transcription";

export const dynamic = "force-dynamic";
// after() runs the transcription inside this route's budget.
export const maxDuration = 300;

/**
 * Starts (or retries) transcribing a stored recording (#341). The upload's
 * own completion normally does this; the Journal page calls it for logs
 * still at `uploaded` (the key was added later, or that kick-off never
 * ran) and for Retry on a failed or abandoned attempt. Answers right away
 * with `{ started }`; the page polls for the result.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isTranscriptionConfigured()) {
    return NextResponse.json({ error: "Transcription is not configured on this deployment" }, { status: 503 });
  }
  const { id } = await params;
  if (!isVideoLogId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const claimed = await claimTranscription(id.toLowerCase());
    if (claimed) after(() => runTranscription(claimed));
    return NextResponse.json({ started: claimed !== null });
  } catch (error) {
    return videoLogErrorResponse(error);
  }
}
