/**
 * Runs the data-inconsistency scan (#13) against DATABASE_URL and prints
 * counts. The monthly workflow (scheduled-inconsistency-scan.yml, #673)
 * runs this; so can you, by hand.
 *
 * Usage:
 *   npm run scan:inconsistencies             # dry run: detect, write nothing
 *   npm run scan:inconsistencies -- --commit # persist findings + a scan-run row
 *   ... -- --commit --scheduled              # the workflow's unattended run
 *
 * Dry run by default, like seed-pr-fixture.mjs: a first run against real
 * history can add hundreds of findings, so seeing the counts first is
 * the safe order.
 *
 * A manual --commit goes through prod-guard.mjs like every other
 * write-capable script. --scheduled skips it, since nobody is there to
 * type the confirmation, and that run is meant to write to production.
 *
 * Prints counts only, never finding details. Those are personal data,
 * and this runs in a public repo's Actions logs. For the same reason,
 * --scheduled reduces a failure to the error's type and code: a database
 * error's message includes the failed query's parameters, which here are
 * finding details.
 */
import { guardAgainstProd } from "./lib/prod-guard.mjs";
import { runInconsistencyScan } from "../src/lib/inconsistency-scan/run.ts";

const args = new Set(process.argv.slice(2));
const commit = args.has("--commit");
const scheduled = args.has("--scheduled");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (commit && !scheduled) await guardAgainstProd({ scriptName: "run-inconsistency-scan.mjs" });

let summary;
try {
  summary = await runInconsistencyScan({ trigger: scheduled ? "scheduled" : "manual", dryRun: !commit });
} catch (err) {
  if (!scheduled) throw err;
  const code = err?.cause?.code ?? err?.code;
  console.error(`Scan failed: ${err?.name ?? "Error"}${code ? ` (code ${code})` : ""}. Details withheld from public logs; run it locally to see them.`);
  process.exit(1);
}

console.log(commit ? "Scan complete." : "Dry run (nothing written; pass --commit to persist).");
console.log(`Detected: ${summary.detected}`);
for (const [type, n] of Object.entries(summary.byType)) console.log(`  ${type}: ${n}`);
if (commit) {
  console.log(`New since last run: ${summary.added}`);
  console.log(`Resolved (no longer reproduce): ${summary.resolved}`);
}
