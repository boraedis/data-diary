import { NextResponse } from "next/server";
import { parseFindingStatus } from "@/lib/inconsistency-scan/links";
import { setFindingStatus } from "@/lib/inconsistency-scan/review";

export const dynamic = "force-dynamic";

// The review page's dismiss / resolve / reopen (#672): one PATCH with the
// new status rather than a route per action, since "undo" is just setting
// it back to open.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const status = parseFindingStatus((body as { status?: unknown } | null)?.status);
  if (!status) {
    return NextResponse.json({ error: "status must be open, dismissed or resolved" }, { status: 400 });
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
