import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  inconsistencyFindings as t,
  inconsistencyScanRuns,
  type InconsistencyStatus,
  type InconsistencyType,
} from "@/db/schema";

/**
 * The review page's reads and writes (#672). The scan runner (run.ts)
 * owns creating and auto-resolving findings. This module only lists them
 * and records what you decided about one.
 */

export type ReviewFinding = {
  id: number;
  type: InconsistencyType;
  entityTable: string;
  date: string | null;
  field: string | null;
  detail: string;
  status: InconsistencyStatus;
  reviewedAt: Date | null;
};

/** One status's findings, newest date first (where you're likeliest to remember). */
export async function listFindings(status: InconsistencyStatus): Promise<ReviewFinding[]> {
  return getDb()
    .select({
      id: t.id,
      type: t.type,
      entityTable: t.entityTable,
      date: t.date,
      field: t.field,
      detail: t.detail,
      status: t.status,
      reviewedAt: t.reviewedAt,
    })
    .from(t)
    .where(eq(t.status, status))
    .orderBy(sql`${t.date} desc nulls last`, desc(t.id));
}

export async function countFindingsByStatus(): Promise<Record<InconsistencyStatus, number>> {
  const rows = await getDb()
    .select({ status: t.status, n: sql<number>`count(*)::int` })
    .from(t)
    .groupBy(t.status);
  const counts: Record<InconsistencyStatus, number> = { open: 0, dismissed: 0, resolved: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  return counts;
}

/** For the Home and Manage badges, which only need the one number. */
export async function countOpenFindings(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(eq(t.status, "open"));
  return Number(row?.n ?? 0);
}

export async function getLastScanRun() {
  const [run] = await getDb()
    .select()
    .from(inconsistencyScanRuns)
    .orderBy(desc(inconsistencyScanRuns.startedAt))
    .limit(1);
  return run ?? null;
}

/**
 * Records a review decision. Any status can move to any other, so a
 * dismissal or a "resolved" can be undone by setting it back to open.
 * `reviewedAt` is set for a decision and cleared on reopening, which is
 * what tells a hand-resolved finding from one the scan resolved itself
 * (see the schema comment). Returns false when there's no such finding.
 */
export async function setFindingStatus(id: number, status: InconsistencyStatus): Promise<boolean> {
  const rows = await getDb()
    .update(t)
    .set({ status, reviewedAt: status === "open" ? null : new Date() })
    .where(eq(t.id, id))
    .returning({ id: t.id });
  return rows.length > 0;
}
