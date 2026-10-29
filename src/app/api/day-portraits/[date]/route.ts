import { NextResponse } from "next/server";
import { isValidDateString } from "@/lib/date";
import { MAX_PORTRAIT_BYTES, validatePortraitUpload } from "@/lib/day-portraits/rules";
import { getDayPortrait, PortraitError, saveDayPortrait } from "@/lib/day-portraits/store";
import { R2NotConfiguredError, getR2Config } from "@/lib/video-journal/r2";

export const dynamic = "force-dynamic";

// Day portraits (#688). Signed-in only like every /api route outside
// src/proxy.ts's public list; nothing here is public.

function notConfigured(): NextResponse | null {
  return getR2Config()
    ? null
    : NextResponse.json({ error: "Photo storage is not configured on this deployment" }, { status: 503 });
}

function failure(error: unknown): NextResponse {
  if (error instanceof PortraitError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof R2NotConfiguredError) return NextResponse.json({ error: error.message }, { status: 503 });
  console.error("[day-portraits]", error);
  const message =
    error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : "Unknown error";
  return NextResponse.json({ error: message }, { status: 502 });
}

/** The day's portrait with a fresh presigned URL, or `{ portrait: null }`. */
export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isValidDateString(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const missing = notConfigured();
  if (missing) return missing;

  try {
    return NextResponse.json({ portrait: await getDayPortrait(date) });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Saves the request body as the day's portrait, replacing any earlier one.
 * The body is the raw image (not multipart), `Content-Type` its type, and
 * the optional `X-Captured-At` header the device's ISO capture time.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isValidDateString(date)) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const missing = notConfigured();
  if (missing) return missing;

  // Reject on the headers before reading a body that could be huge.
  const declaredLength = request.headers.get("content-length");
  const early = validatePortraitUpload({
    contentType: request.headers.get("content-type"),
    sizeBytes: declaredLength === null ? null : Number(declaredLength),
    bytes: null,
  });
  if (!early.ok) return NextResponse.json({ error: early.error }, { status: early.status });

  const bytes = new Uint8Array(await request.arrayBuffer());
  const checked = validatePortraitUpload({
    contentType: request.headers.get("content-type"),
    sizeBytes: Math.min(bytes.byteLength, MAX_PORTRAIT_BYTES + 1),
    bytes,
  });
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });

  const capturedHeader = request.headers.get("x-captured-at");
  const parsed = capturedHeader ? new Date(capturedHeader) : new Date();
  // A bad or absent device clock falls back to the server's, which is only
  // ever a few seconds off for a photo just taken.
  const capturedAt = Number.isNaN(parsed.getTime()) ? new Date() : parsed;

  try {
    const portrait = await saveDayPortrait({ date, bytes, mimeType: checked.mimeType, capturedAt });
    return NextResponse.json({ portrait });
  } catch (error) {
    return failure(error);
  }
}
