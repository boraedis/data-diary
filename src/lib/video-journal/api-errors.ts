import { NextResponse } from "next/server";
import { R2NotConfiguredError, getR2Config } from "@/lib/video-journal/r2";
import { VideoLogError } from "@/lib/video-journal/video-logs";

// Shared error mapping for the /api/video-logs routes (#339).

/** 503 before doing anything when R2 isn't configured on this deployment.
 * The recorder treats 503 as "keep it on the device", not as a failure. */
export function r2NotConfiguredResponse(): NextResponse | null {
  return getR2Config()
    ? null
    : NextResponse.json({ error: "Video storage is not configured on this deployment" }, { status: 503 });
}

export function videoLogErrorResponse(error: unknown): NextResponse {
  if (error instanceof VideoLogError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof R2NotConfiguredError) {
    return NextResponse.json({ error: error.message }, { status: 503 });
  }
  console.error("[video-logs]", error);
  // A failed Drizzle query's message is the SQL; the driver's reason (e.g.
  // a missing table) is on `cause`, and is what the recorder should show.
  const message =
    error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : "Unknown error";
  return NextResponse.json(
    { error: message },
    // 502: almost every unexpected failure here is R2 or the database
    // misbehaving, and the device should retry later rather than give up.
    { status: 502 },
  );
}
