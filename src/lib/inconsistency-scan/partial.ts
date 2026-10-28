import {
  expectedFieldsByDate,
  isDayLogged,
  isFieldFilled,
  type ExpectationOptions,
} from "@/lib/expected-fields";
import { SCAN_FIELDS, type Finding, type ScanInput } from "./types";

/**
 * Type 2 findings, "partially filled" (#13): a logged day that's missing
 * a field you habitually fill, where "habitually" is your own trailing
 * fill rate from the expected-fields registry rather than a fixed list.
 */

/**
 * Stricter than the registry's generic 0.8: a field is only expected
 * when you skip it on fewer than one logged day in ten. Tuned against
 * production history on #670. Over ten years, 0.8 flagged 446 days,
 * 0.9 flagged 256 and 0.95 flagged 131. The extra 190 at 0.8 were
 * mostly positive people, Instagram counts and weight, the fields you
 * log in phases, flagged at the edges of those phases. 0.9 keeps the
 * real holes (missing sleep times and journal show up at every cutoff)
 * at a backlog of about 25 a year. "Positive
 * people" leads at any cutoff, and the empty ones are often genuine
 * days alone, which is what dismissing is for.
 */
export const PARTIAL_CUTOFF = 0.9;

/**
 * One finding per day, listing every expected field it's missing, rather
 * than one per (day, field). A day you only half logged is one thing to
 * go back and fix, and per-field rows would bury the review page under
 * ten findings for that one day. The cost is that dismissing it dismisses
 * the whole day, which is usually what you mean ("I was sick, that's all
 * I logged") anyway.
 *
 * `field` is left null even when a single field is missing, so the
 * finding keeps its identity (and a dismissal) as the list changes.
 *
 * Only logged days are judged. A day with nothing filled at all is
 * `detectMissingDays`' finding.
 */
export function detectPartialDays(
  input: ScanInput,
  options: Omit<ExpectationOptions, "fields"> = {}
): Finding[] {
  const fields = SCAN_FIELDS;
  const expectedByDate = expectedFieldsByDate(input.snapshots, {
    cutoff: PARTIAL_CUTOFF,
    ...options,
    fields,
  });

  const findings: Finding[] = [];
  for (const s of input.snapshots) {
    if (s.date > input.lastJudgedDate || !isDayLogged(s, fields)) continue;
    const expected = expectedByDate.get(s.date);
    if (!expected || expected.size === 0) continue;
    const missing = fields.filter((f) => expected.has(f.key) && !isFieldFilled(f, s));
    if (missing.length === 0) continue;
    findings.push({
      type: "partial",
      entityTable: "days",
      date: s.date,
      detail: `Missing: ${missing.map((f) => f.label).join(", ")}`,
    });
  }
  return findings.sort((a, b) => (a.date! < b.date! ? -1 : 1));
}
