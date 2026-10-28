/**
 * Runs the data-inconsistency scan (#13) against DATABASE_URL and prints
 * counts. The monthly workflow (#673) runs this; so can you, by hand.
 *
 * Usage:
 *   npm run scan:inconsistencies             # dry run: detect, write nothing
 *   npm run scan:inconsistencies -- --commit # persist findings + a scan-run row
 *   ... -- --commit --scheduled              # record the run as "scheduled"
 *
 * Dry run by default, like seed-pr-fixture.mjs: a first run against real
 * history can add hundreds of findings, so seeing the counts first is
 * the safe order.
 *
 * Prints counts only, never finding details. Those are personal data,
 * and this runs in a public repo's Actions logs.
 */
import { runInconsistencyScan } from "../src/lib/inconsistency-scan/run.ts";

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");

const summary = await runInconsistencyScan({
  trigger: args.has("--scheduled") ? "scheduled" : "manual",
  dryRun: !commit,
});

console.log(commit ? "Scan complete." : "Dry run (nothing written; pass --commit to persist).");
console.log(`Detected: ${summary.detected}`);
for (const [type, n] of Object.entries(summary.byType)) console.log(`  ${type}: ${n}`);
if (commit) {
  console.log(`New since last run: ${summary.added}`);
  console.log(`Resolved (no longer reproduce): ${summary.resolved}`);
}
