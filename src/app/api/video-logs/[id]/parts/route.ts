import { NextResponse } from "next/server";
import { r2NotConfiguredResponse, videoLogErrorResponse } from "@/lib/video-journal/api-errors";
import { isVideoLogId, validatePartNumbers } from "@/lib/video-journal/video-log-types";
import { getVideoLogSize, presignVideoLogParts } from "@/lib/video-journal/video-logs";

export const dynamic = "force-dynamic";

/** Presigned PUT URLs for some of an open upload's parts (#339). The
 * browser sends the bytes straight to R2 with them. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const notConfigured = r2NotConfiguredResponse();
  if (notConfigured) return notConfigured;

  const { id } = await params;
  if (!isVideoLogId(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const parsed = validatePartNumbers(body, await getVideoLogSize(id.toLowerCase()));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    return NextResponse.json({ parts: await presignVideoLogParts(id.toLowerCase(), parsed.value) });
  } catch (error) {
    return videoLogErrorResponse(error);
  }
}
