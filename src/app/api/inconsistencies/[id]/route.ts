import { NextResponse } from "next/server";
import { parseReviewStatus } from "@/lib/inconsistency-scan/links";
import { setFindingStatus } from "@/lib/inconsistency-scan/review";

export const dynamic = "force-dynamic";

// The review page's dismiss and reopen (#672): one PATCH with the new
// status rather than a route per action, since "undo" is just setting it
// back to open. "resolved" is refused: only the scan resolves (#685).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const status = parseReviewStatus((body as { status?: unknown } | null)?.status);
  if (!status) {
    return NextResponse.json(
      { error: "status must be open or dismissed; findings are resolved by rescanning" },
      { status: 400 }
    );
  }

  try {
    const found = await setFindingStatus(id, status);
    if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("inconsistency status update failed", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
