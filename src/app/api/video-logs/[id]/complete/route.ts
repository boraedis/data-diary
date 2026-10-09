import { after, NextResponse } from "next/server";
import { r2NotConfiguredResponse, videoLogErrorResponse } from "@/lib/video-journal/api-errors";
import { isVideoLogId } from "@/lib/video-journal/video-log-types";
import { claimTranscription, isTranscriptionConfigured, runTranscription } from "@/lib/video-journal/transcription";
import { completeVideoLogUpload } from "@/lib/video-journal/video-logs";

export const dynamic = "force-dynamic";
// The transcription kicked off below runs inside this route's budget
// (after() shares it), so give it the full 300s.
export const maxDuration = 300;

/** Verify every part reached R2, complete the upload, and mark the log
 * `uploaded` (#339). The device deletes its local copy only after this
 * succeeds. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const notConfigured = r2NotConfiguredResponse();
  if (notConfigured) return notConfigured;

  const { id } = await params;
  if (!isVideoLogId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const summary = await completeVideoLogUpload(id.toLowerCase());
    // Transcribe without making the device wait for it (#341). If this
    // never runs (no key yet, function killed), the Journal page starts it
    // later via /transcribe.
    if (summary.status === "uploaded" && isTranscriptionConfigured()) {
      const claimed = await claimTranscription(summary.id);
      if (claimed) {
        after(() => runTranscription(claimed));
        return NextResponse.json({ ...summary, status: "transcribing" });
      }
    }
    return NextResponse.json(summary);
  } catch (error) {
    return videoLogErrorResponse(error);
  }
}
