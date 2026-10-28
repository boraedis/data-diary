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
  const expectedByDate = expectedFieldsByDate(input.snapshots, { ...options, fields });

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
