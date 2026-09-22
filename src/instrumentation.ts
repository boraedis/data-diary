/**
 * Runs once per serverless function instance, before it serves its first
 * request (Next.js's instrumentation hook — see
 * https://nextjs.org/docs/app/guides/instrumentation). Used here to fix a
 * gap in how Preview Deployments get their database: pr-db-branch-create.yml
 * (.github/workflows/) gives every PR its own disposable Neon branch, named
 * `pr-<N>`, with that PR's schema already applied (see also
 * scripts/dev-pr.mjs, which does the same lookup for local dev) — but
 * nothing wires that connection string into the actual Vercel Preview
 * Deployment for the PR. Left alone, every preview shares whatever single
 * DATABASE_URL is configured for the Preview environment in Vercel's
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
 * The connection string is fetched directly from the Neon API rather than
 * a PR comment: this repo is public, so a PR comment containing a live
 * connection string would have published a working credential to a copy of
 * production data for as long as the PR stayed open (#376).
 * scripts/dev-pr.mjs fetches the same way for local dev.
 *
 * One-time setup: in the Vercel project's Settings -> Environment Variables,
 * check "Enable access to System Environment Variables" (off by default —
 * without it, VERCEL_GIT_PULL_REQUEST_ID etc. are never populated and this
 * always falls through to the fallback below). Also add, Preview-scoped:
 * - NEON_API_KEY / NEON_PROJECT_ID — the same values
 *   pr-db-branch-create.yml uses, so this can look the PR's branch up
 *   directly instead of relying on a PR comment.
 * - FALLBACK_DATABASE_URL — the fallback for a preview with no open PR yet
 *   (e.g. a branch pushed before opening one), or for any preview where the
 *   Neon lookup below doesn't succeed (missing NEON_API_KEY, branch not
 *   created yet, API error — see resolvePrDatabaseUrl). Point it at a
 *   connection string for the `production` branch (Neon console ->
 *   production branch -> Connection Details).
 * DATABASE_URL itself can then be removed from the Preview environment
 * entirely, since this always sets it before anything reads it.
 *
 * NOTE: this was named QA_DATABASE_URL until the per-PR branches' parent
 * moved from `qa` to `production` (pr-db-branch-create.yml) — it's renamed
 * here to match, since it's no longer specifically "the qa connection
 * string." The incident that prompted that rename was this exact fallback
 * silently serving a stale/dead `qa` connection string and surfacing as
 * "password authentication failed for user 'neondb_owner'" on a PR's
 * Preview deployment, even though that PR's own branch (and the primary
 * create-branch-action run for it) was completely healthy. Also worth
 * checking: does the `qa` Neon branch still exist at all? ci.yml's
 * QA_DATABASE_URL secret and qa-branch-refresh.yml's daily reset still
 * depend on it, independent of this file.
 */
const NEON_API_BASE = "https://console.neon.tech/api/v2";

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
        `[instrumentation] PR #${prNumber}: no Neon branch "pr-${prNumber}" found yet (workflow may still be running, or NEON_API_KEY/NEON_PROJECT_ID isn't set) — falling back to FALLBACK_DATABASE_URL.`
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

async function neonApi(apiKey: string, path: string) {
  const res = await fetch(`${NEON_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Neon API ${path} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function resolvePrDatabaseUrl(prNumber: string): Promise<string | null> {
  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!apiKey || !projectId) return null;

  const branchName = `pr-${prNumber}`;
  const { branches } = (await neonApi(apiKey, `/projects/${projectId}/branches`)) as {
    branches: { id: string; name: string }[];
  };
  const branch = branches.find((b) => b.name === branchName);
  if (!branch) return null;

  const [{ databases }, { roles }] = await Promise.all([
    neonApi(apiKey, `/projects/${projectId}/branches/${branch.id}/databases`) as Promise<{ databases: { name: string }[] }>,
    neonApi(apiKey, `/projects/${projectId}/branches/${branch.id}/roles`) as Promise<{ roles: { name: string }[] }>,
  ]);
  if (databases.length === 0 || roles.length === 0) return null;

  const params = new URLSearchParams({
    branch_id: branch.id,
    database_name: databases[0].name,
    role_name: roles[0].name,
    pooled: "true",
  });
  const { uri } = (await neonApi(apiKey, `/projects/${projectId}/connection_uri?${params}`)) as { uri: string };
  return uri;
}
