import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { inconsistencyFindings, inconsistencyScanRuns, type InconsistencyType } from "@/db/schema";
import { toDateString } from "@/lib/date";
import { loadScanInput } from "./load";
import { detectDomainGaps, detectMissingDays } from "./missing";
import { detectPartialDays } from "./partial";
import { findingKey, type Detector, type Finding, type ScanInput } from "./types";

/**
 * The scan runner (#670): load, run every detector, persist. The only
 * part of the scan that touches the database. The monthly workflow
 * (#673) and the review page's "Run scan now" (#672) both call
 * `runInconsistencyScan`.
 */

// Add a detector here and it runs everywhere the scan does (#671 adds
// the outlier and referential ones).
export const DETECTORS: readonly Detector[] = [
  detectMissingDays,
  detectDomainGaps,
  detectPartialDays,
];

/** Every detector's findings, one per key (the first wins on a collision). */
export function detectAll(input: ScanInput, detectors: readonly Detector[] = DETECTORS): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const detect of detectors) {
    for (const f of detect(input)) {
      const key = findingKey(f);
      if (!byKey.has(key)) byKey.set(key, f);
    }
  }
  return [...byKey.values()];
}

export type ScanSummary = {
  detected: number;
  byType: Record<InconsistencyType, number>;
  // Null on a dry run, which writes nothing.
  added: number | null;
  resolved: number | null;
};

// Rows per insert. Postgres caps a statement at 65,535 bind parameters
// and a finding row takes 9, so this keeps a year of first-run findings
// well clear of the limit.
const CHUNK = 500;

export async function runInconsistencyScan(options: {
  trigger: "manual" | "scheduled";
  dryRun?: boolean;
  today?: string;
}): Promise<ScanSummary> {
  const startedAt = new Date();
  const input = await loadScanInput(options.today ?? toDateString(startedAt));
  const findings = detectAll(input);

  const byType: ScanSummary["byType"] = { missing: 0, partial: 0, outlier: 0, referential: 0 };
  for (const f of findings) byType[f.type]++;
  if (options.dryRun) return { detected: findings.length, byType, added: null, resolved: null };

  const db = getDb();
  const t = inconsistencyFindings;
  let added = 0;
  for (let i = 0; i < findings.length; i += CHUNK) {
    const rows = findings.slice(i, i + CHUNK).map((f) => ({
      findingKey: findingKey(f),
      type: f.type,
      entityTable: f.entityTable,
      entityId: f.entityId ?? null,
      date: f.date ?? null,
      field: f.field ?? null,
      detail: f.detail,
      firstDetectedAt: startedAt,
      lastSeenAt: startedAt,
    }));
    // One upsert carries the whole status lifecycle (see the schema
    // comment on inconsistencyFindings): dismissed stays dismissed, open
    // stays open, and a resolved finding that reproduces is reopened,
    // clearing reviewedAt since that review no longer holds.
    const result = await db
      .insert(t)
      .values(rows)
      .onConflictDoUpdate({
        target: t.findingKey,
        set: {
          detail: sql`excluded.detail`,
          lastSeenAt: sql`excluded.last_seen_at`,
          status: sql`case when ${t.status} = 'resolved' then 'open'::inconsistency_status else ${t.status} end`,
          reviewedAt: sql`case when ${t.status} = 'resolved' then null else ${t.reviewedAt} end`,
        },
      })
      // xmax is 0 only on a freshly inserted row, so this tells new
      // findings from re-seen ones without a separate read.
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    added += result.filter((r) => r.inserted).length;
  }

  // Open findings this run didn't reproduce: fixed since, or no longer
  // judged a problem under today's expectations. reviewedAt stays null,
  // which marks them as resolved by the scan rather than by hand.
  const resolvedRows = await db
    .update(t)
    .set({ status: "resolved" })
    .where(and(eq(t.status, "open"), lt(t.lastSeenAt, startedAt)))
    .returning({ id: t.id });

  await db.insert(inconsistencyScanRuns).values({
    startedAt,
    trigger: options.trigger,
    detected: findings.length,
    added,
    resolved: resolvedRows.length,
  });

  return { detected: findings.length, byType, added, resolved: resolvedRows.length };
}
