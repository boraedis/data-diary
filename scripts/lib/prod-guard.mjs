/**
 * Safety gate for one-off scripts that write straight to whatever Postgres
 * database DATABASE_URL happens to resolve to (backfill-place-paths.mjs,
 * split-duplicate-places.mjs, migrate-history.mjs --commit). Added after a
 * real incident: DATABASE_URL was still set to production from an earlier
 * session, a script was run believing it was pointed at qa, and it wrote
 * straight to prod with no warning at all.
 *
 * There's no way to tell "is this prod?" from the connection string alone
 * — Neon's per-branch hostnames aren't self-describing — so this relies on
 * you listing your production database's hostname(s) once, in
 * PROD_DB_HOSTS (comma-separated; include both the pooled and direct
 * hostnames if your prod connection string ever uses either — a hostname
 * isn't a credential, so this is safe to keep in .env/.env.local next to
 * DATABASE_URL itself). If PROD_DB_HOSTS isn't set, this can't detect
 * anything and silently no-ops — better to add it than trust every
 * environment always has it configured, but do add it.
 *
 * When the target IS recognized as prod, this blocks until you type the
 * literal word PRODUCTION (typo-proof, no secret needed — catches "I
 * thought I was in qa" mistakes) and, if APP_PASSWORD is set locally, also
 * requires typing it correctly (a real secret gate, in case a script ever
 * runs somewhere no one is reading the terminal output carefully).
 *
 * Usage — call this before any write, after your own DATABASE_URL check:
 *   import { guardAgainstProd } from "./lib/prod-guard.mjs";
 *   await guardAgainstProd({ scriptName: "backfill-place-paths.mjs" });
 */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

function resolveHost(databaseUrl) {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return null;
  }
}

export async function guardAgainstProd({ scriptName = "This script" } = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  const prodHosts = (process.env.PROD_DB_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  if (prodHosts.length === 0) {
    console.warn(
      "prod-guard: PROD_DB_HOSTS isn't set locally, so I can't tell whether DATABASE_URL points at " +
        "production — skipping the confirmation gate. Set PROD_DB_HOSTS in your shell/.env.local to " +
        "your production Neon hostname(s) so this actually protects you. See scripts/lib/prod-guard.mjs.\n"
    );
    return;
  }

  const host = resolveHost(databaseUrl);
  if (!host || !prodHosts.includes(host)) return; // qa, a PR branch, local — nothing to guard

  console.log("");
  console.log("!".repeat(70));
  console.log(`!!  ${scriptName} is about to run against PRODUCTION (${host})`);
  console.log("!".repeat(70));
  console.log("");

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const typed = await rl.question('Type PRODUCTION (all caps) to confirm you mean to do this, or anything else to abort: ');
    if (typed.trim() !== "PRODUCTION") {
      console.error("\nConfirmation text didn't match — aborting, nothing was run.");
      process.exit(1);
    }

    if (process.env.APP_PASSWORD) {
      const pw = await rl.question("Enter APP_PASSWORD to confirm: ");
      if (pw !== process.env.APP_PASSWORD) {
        console.error("\nPassword didn't match — aborting, nothing was run.");
        process.exit(1);
      }
    } else {
      console.warn("(APP_PASSWORD isn't set locally, so skipping that check — set it to require it here too.)");
    }
  } finally {
    rl.close();
  }

  console.log("\nConfirmed — continuing against PRODUCTION.\n");
}
