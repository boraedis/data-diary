import { NextResponse } from "next/server";
import { r2NotConfiguredResponse, videoLogErrorResponse } from "@/lib/video-journal/api-errors";
import { validateStartUpload } from "@/lib/video-journal/video-log-types";
import { startVideoLogUpload } from "@/lib/video-journal/video-logs";

export const dynamic = "force-dynamic";

/** Start, or resume, uploading a recording (#339). Idempotent on the
 * recording's id; returns the parts R2 already has. */
export async function POST(request: Request) {
  const notConfigured = r2NotConfiguredResponse();
  if (notConfigured) return notConfigured;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = validateStartUpload(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    return NextResponse.json(await startVideoLogUpload(parsed.value));
  } catch (error) {
    return videoLogErrorResponse(error);
  }
}
