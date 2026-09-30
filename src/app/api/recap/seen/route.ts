import { NextResponse } from "next/server";
import { markRecapSeen } from "@/lib/recap-seen";

export const dynamic = "force-dynamic";

// Marks one recap as opened (#518). A POST, not a write during the page's
// render: a prefetch or a crawler-style GET of the page must never count as
// the owner having read it, so the page asks for this explicitly from the
// client once it has actually been shown.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const key = typeof body === "object" && body !== null ? (body as { key?: unknown }).key : undefined;
  if (typeof key !== "string") {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  try {
    const marked = await markRecapSeen(key);
    if (!marked) {
      return NextResponse.json({ error: "Not a published recap" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
