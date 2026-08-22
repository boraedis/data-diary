import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

// Never statically cache this — it's a live DB check, and statically
// evaluating it at build time is exactly what broke the build in the
// first place.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sql = getSql();
    await sql`select 1`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
