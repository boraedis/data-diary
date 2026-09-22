/**
 * Points local dev at the current branch's PR database, then starts
 * `next dev` — so testing a feature branch's schema changes never needs a
 * manually copy-pasted connection string.
 *
 * How it works: pr-db-branch-create.yml (.github/workflows/) creates an
 * isolated Neon branch named `pr-<N>` for every open PR into main, with
 * this PR's schema already applied, and comments on the PR once it's
 * ready. This script finds the open PR for your current git branch, then
 * asks the Neon API directly for that branch's connection string and
 * rewrites the DATABASE_URL line in .env.local to match — leaving every
 * other line in .env.local untouched.
 *
 * The connection string is fetched straight from Neon rather than scraped
 * out of the PR comment: this repo is public, so a comment containing a
 * live connection string would have published a working credential to a
 * copy of the real diary data for as long as the PR stayed open (#376).
 * The PR comment now only says the branch is ready.
 *
 * Usage:
 *   npm run dev:pr
 *
 * Requires NEON_API_KEY (a Neon API key with access to this project) and
 * NEON_PROJECT_ID in your environment or .env.local — the same values the
 * "PR database branch" workflow uses, just available locally too. Neither
 * is GitHub-specific, so a Neon API key with only this project's scope is
 * enough; don't reuse an org-wide key here.
 *
 * Optional: set GITHUB_TOKEN (any PAT with public-repo read access, or
 * none at all since this repo is public) to avoid GitHub's 60/hour
 * unauthenticated API rate limit if you run this a lot.
 */
import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const REPO_FALLBACK = "boraedis/data-diary";
const NEON_API_BASE = "https://console.neon.tech/api/v2";

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

// .env.local isn't loaded by node by default outside of `next dev` itself —
// read NEON_API_KEY/NEON_PROJECT_ID out of it directly if they're not
// already in the environment, without touching any other variable there.
function loadDotEnvLocalFallback(keys) {
  const envPath = ".env.local";
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && keys.includes(match[1]) && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
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

async function neonApi(apiKey, path) {
  const res = await fetch(`${NEON_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Neon API ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchBranchConnectionString(apiKey, projectId, branchName) {
  const { branches } = await neonApi(apiKey, `/projects/${projectId}/branches`);
  const branch = branches.find((b) => b.name === branchName);
  if (!branch) {
    throw new Error(
      `No Neon branch named "${branchName}" found in project ${projectId} yet. Check the "PR database branch" workflow run in the Actions tab — it may still be running.`
    );
  }

  const { databases } = await neonApi(apiKey, `/projects/${projectId}/branches/${branch.id}/databases`);
  const { roles } = await neonApi(apiKey, `/projects/${projectId}/branches/${branch.id}/roles`);
  if (databases.length === 0 || roles.length === 0) {
    throw new Error(`Branch "${branchName}" has no database/role to build a connection string from.`);
  }
  const databaseName = databases[0].name;
  const roleName = roles[0].name;

  const params = new URLSearchParams({
    branch_id: branch.id,
    database_name: databaseName,
    role_name: roleName,
    pooled: "true",
  });
  const { uri } = await neonApi(apiKey, `/projects/${projectId}/connection_uri?${params}`);
  return uri;
}

async function main() {
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  if (branch === "main") {
    console.error("On main — there's no PR-specific database for main (main uses PROD_DATABASE_URL). Nothing to do.");
    process.exit(1);
  }

  loadDotEnvLocalFallback(["NEON_API_KEY", "NEON_PROJECT_ID", "GITHUB_TOKEN"]);
  const neonApiKey = process.env.NEON_API_KEY;
  const neonProjectId = process.env.NEON_PROJECT_ID;
  if (!neonApiKey || !neonProjectId) {
    console.error(
      "Missing NEON_API_KEY and/or NEON_PROJECT_ID. Set both in your environment or .env.local — see scripts/dev-pr.mjs's header comment."
    );
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
  const readyComment = comments.find((c) => c.body?.includes("Isolated test database ready"));
  if (!readyComment) {
    console.error(
      `PR #${pr.number} doesn't have a database-ready comment yet. Check the "PR database branch" workflow run in the Actions tab — it may still be running, or may have failed (missing NEON_API_KEY/NEON_PROJECT_ID?).`
    );
    process.exit(1);
  }

  const branchName = `pr-${pr.number}`;
  console.log(`Fetching connection string for Neon branch "${branchName}"...`);
  const databaseUrl = await fetchBranchConnectionString(neonApiKey, neonProjectId, branchName);

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
