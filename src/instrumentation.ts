/**
 * Runs once per serverless function instance, before it serves its first
 * request (Next.js's instrumentation hook — see
 * https://nextjs.org/docs/app/guides/instrumentation). Used here to fix a
 * gap in how Preview Deployments get their database: pr-db-branch-create.yml
 * (.github/workflows/) gives every PR its own disposable Neon branch with
 * that PR's schema already applied and posts its connection string as a PR
 * comment (see also scripts/dev-pr.mjs, which does the same lookup for local
 * dev) — but nothing wires that connection string into the actual Vercel
 * Preview Deployment for the PR. Left alone, every preview shares whatever
 * single DATABASE_URL is configured for the Preview environment in Vercel's
 * dashboard, which in practice ends up being the shared `qa` database — so
 * a PR that changes the schema (adds/renames/drops a column) 500s on its
 * own preview with a "column does not exist" error, because the preview is
 * quietly querying `qa`'s unmigrated schema instead of its own branch's.
 *
 * This resolves the PR's actual database at cold start and overwrites
 * process.env.DATABASE_URL in place, so src/lib/db.ts's existing lazy
 * getConnectionString() — unchanged — picks up the right value the first
 * time anything actually queries the database. Only ever touches Preview
 * deployments; Production and local dev are untouched (see the VERCEL_ENV
 * check below), and this file only runs on Vercel — VERCEL_ENV is unset
 * everywhere else (CI, local dev), so it's a no-op there.
 *
 * One-time setup: in the Vercel project's Settings -> Environment Variables,
 * check "Enable access to System Environment Variables" (off by default —
 * without it, VERCEL_GIT_PULL_REQUEST_ID etc. are never populated and this
 * always falls through to the fallback below). Also add a
 * FALLBACK_DATABASE_URL Preview-scoped env var — that becomes the fallback
 * for a preview with no open PR yet (e.g. a branch pushed before opening
 * one), *or* for any preview where the GitHub comment lookup below doesn't
 * succeed (private repo without GITHUB_READ_TOKEN, GitHub API rate limit,
 * workflow still running, etc. — see resolvePrDatabaseUrl). DATABASE_URL
 * itself can then be removed from the Preview environment entirely, since
 * this always sets it before anything reads it.
 *
 * NOTE: this was named QA_DATABASE_URL until the per-PR branches' parent
 * moved from `qa` to `production` (pr-db-branch-create.yml) — it's renamed
 * here to match, since it's no longer specifically "the qa connection
 * string." Point it at a connection string for the `production` branch
 * (Neon console -> production branch -> Connection Details), NOT the old
 * `qa` branch's string — the incident that prompted this rename was this
 * exact fallback silently serving a stale/dead `qa` connection string and
 * surfacing as "password authentication failed for user 'neondb_owner'" on
 * a PR's Preview deployment, even though that PR's own branch (and the
 * primary create-branch-action run for it) was completely healthy. Also
 * worth checking: does the `qa` Neon branch still exist at all? ci.yml's
 * QA_DATABASE_URL secret and qa-branch-refresh.yml's daily reset still
 * depend on it, independent of this file.
 *
 * Optional hardening: set a GITHUB_READ_TOKEN Preview-scoped env var (a
 * fine-grained PAT with read-only "Issues" access on this repo) so the
 * comment lookup below is authenticated. Without it, the lookup is
 * anonymous — which silently 403s on a private repo and is easy to
 * rate-limit — and every such failure falls through to
 * FALLBACK_DATABASE_URL above instead of this PR's own branch.
 */
export async function register() {
  // instrumentation.ts also runs for the Edge runtime if the app has any
  // edge routes/middleware; this app doesn't, but the guard costs nothing
  // and keeps this from double-running if that ever changes.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL_ENV !== "preview") return;

  const prNumber = process.env.VERCEL_GIT_PULL_REQUEST_ID;

  if (prNumber) {
    try {
      const resolved = await resolvePrDatabaseUrl(prNumber);
      if (resolved) {
        process.env.DATABASE_URL = resolved;
        return;
      }
      console.warn(
        `[instrumentation] PR #${prNumber}: no "Isolated test database ready" comment found yet (workflow may still be running) — falling back to FALLBACK_DATABASE_URL.`
      );
    } catch (err) {
      console.warn(`[instrumentation] Failed to resolve PR #${prNumber}'s database URL, falling back to FALLBACK_DATABASE_URL:`, err);
    }
  }

  // No open PR for this deployment (a branch preview built before a PR was
  // opened) or the lookup above failed — fall back to the configured
  // fallback database rather than leaving DATABASE_URL pointed at
  // nothing/whatever Vercel has configured by default.
  if (process.env.FALLBACK_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.FALLBACK_DATABASE_URL;
  }
}

async function resolvePrDatabaseUrl(prNumber: string): Promise<string | null> {
  const owner = process.env.VERCEL_GIT_REPO_OWNER || "boraedis";
  const repo = process.env.VERCEL_GIT_REPO_SLUG || "data-diary";

  // GITHUB_READ_TOKEN is optional (see the setup note above) — without it
  // this call is anonymous, which fails closed (403/404, never throws) on
  // a private repo or under GitHub's anonymous rate limit, and that
  // failure is indistinguishable from "workflow hasn't posted yet" below.
  const token = process.env.GITHUB_READ_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    console.warn(`[instrumentation] GitHub comment lookup for PR #${prNumber} returned ${res.status} ${res.statusText}${token ? "" : " (anonymous — no GITHUB_READ_TOKEN set)"}`);
    return null;
  }

  const comments = (await res.json()) as { body?: string }[];
  const dbComment = comments.find((c) => c.body?.includes("Isolated test database ready"));
  const match = dbComment?.body?.match(/DATABASE_URL=(\S+)/);
  return match ? match[1] : null;
}
