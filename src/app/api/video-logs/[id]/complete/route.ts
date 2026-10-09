import { NextResponse } from "next/server";
import { r2NotConfiguredResponse, videoLogErrorResponse } from "@/lib/video-journal/api-errors";
import { isVideoLogId } from "@/lib/video-journal/video-log-types";
import { completeVideoLogUpload } from "@/lib/video-journal/video-logs";

export const dynamic = "force-dynamic";

/** Verify every part reached R2, complete the upload, and mark the log
 * `uploaded` (#339). The device deletes its local copy only after this
 * succeeds. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const notConfigured = r2NotConfiguredResponse();
  if (notConfigured) return notConfigured;

  const { id } = await params;
  if (!isVideoLogId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    return NextResponse.json(await completeVideoLogUpload(id.toLowerCase()));
  } catch (error) {
    return videoLogErrorResponse(error);
  }
}
