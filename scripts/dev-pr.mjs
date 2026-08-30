/**
 * Points local dev at the current branch's PR database, then starts
 * `next dev` — so testing a feature branch's schema changes never needs a
 * manually copy-pasted connection string.
 *
 * How it works: pr-db-branch-create.yml (.github/workflows/) creates an
 * isolated Neon branch for every open PR into main, with this PR's schema
 * already applied, and posts its connection string as a PR comment. This
 * script finds the open PR for your current git branch, reads that
 * comment, and rewrites the DATABASE_URL line in .env.local to match —
 * leaving every other line in .env.local untouched.
 *
 * Usage:
 *   npm run dev:pr
 *
 * Optional: set GITHUB_TOKEN (any PAT with public-repo read access, or
 * none at all since this repo is public) to avoid GitHub's 60/hour
 * unauthenticated API rate limit if you run this a lot.
 */
import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const REPO_FALLBACK = "boraedis/data-diary";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function getRepoSlug() {
  try {
    const url = sh("git remote get-url origin");
    // Handles both git@github.com:owner/repo.git and https://github.com/owner/repo.git
    const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/);
    if (match) return match[1];
  } catch {
    // fall through to fallback
  }
  return REPO_FALLBACK;
}

async function githubApi(path) {
  const headers = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function main() {
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  if (branch === "main") {
    console.error("On main — there's no PR-specific database for main (main uses PROD_DATABASE_URL). Nothing to do.");
    process.exit(1);
  }

  const [owner] = getRepoSlug().split("/");
  const repo = getRepoSlug();
  console.log(`Looking up an open PR for ${owner}:${branch} on ${repo}...`);

  const prs = await githubApi(`/repos/${repo}/pulls?head=${owner}:${branch}&state=open`);
  if (prs.length === 0) {
    console.error(
      `No open PR found for branch "${branch}". Open one into main first — that's what triggers the isolated database branch.`
    );
    process.exit(1);
  }
  const pr = prs[0];
  console.log(`Found PR #${pr.number}: ${pr.title}`);

  const comments = await githubApi(`/repos/${repo}/issues/${pr.number}/comments`);
  const dbComment = comments.find((c) => c.body?.includes("Isolated test database ready"));
  if (!dbComment) {
    console.error(
      `PR #${pr.number} doesn't have a database-ready comment yet. Check the "PR database branch" workflow run in the Actions tab — it may still be running, or may have failed (missing NEON_API_KEY/NEON_PROJECT_ID?).`
    );
    process.exit(1);
  }

  const urlMatch = dbComment.body.match(/DATABASE_URL=(\S+)/);
  if (!urlMatch) {
    console.error("Found the database-ready comment, but couldn't parse a DATABASE_URL out of it. Check it manually:");
    console.error(dbComment.body);
    process.exit(1);
  }
  const databaseUrl = urlMatch[1];

  const envPath = ".env.local";
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = existing.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("DATABASE_URL="));
  lines.push(`DATABASE_URL=${databaseUrl}`);
  writeFileSync(envPath, lines.join("\n") + "\n");
  console.log(`Updated ${envPath} to point at PR #${pr.number}'s database.`);

  console.log("Starting next dev...");
  const child = spawn("npx", ["next", "dev"], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
