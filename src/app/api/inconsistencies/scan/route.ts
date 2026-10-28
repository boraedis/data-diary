import { NextResponse } from "next/server";
import { runInconsistencyScan } from "@/lib/inconsistency-scan/run";

export const dynamic = "force-dynamic";
// A full-history scan reads every day, entry and workout set. That's a
// few seconds today, but it grows with the diary, so this gets the same
// ceiling as the other long-running routes (music import, transcription).
export const maxDuration = 300;

// "Run scan now" on the review page (#672). Same runner as the monthly
// workflow (#673), recorded as a manual run.
export async function POST() {
  try {
    const summary = await runInconsistencyScan({ trigger: "manual" });
    return NextResponse.json(summary);
  } catch (err) {
    console.error("inconsistency scan failed", err);
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
