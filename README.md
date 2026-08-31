# Data Diary

A personal, single-user life-logging app — one row per day, covering sleep, weight,
happiness, work, health, entertainment, people, places, and more, plus a catalog
of everything those entries reference (people, places, exercises, movies, TV
shows, books, sports) and a set of charts over the history that builds up.

This is a from-scratch Next.js/Postgres rebuild of an older Express + EJS +
Firestore version of the same app (see `Data_Diary_App` if you have it
checked out alongside this repo) — it is not a template or a
multi-tenant product, just a personal tool built for one person's own daily
data.

## Features

**Day log** (`/day/[date]`) — a single page per calendar day with a section per
category, each showing an at-a-glance "N/total filled" progress badge:

- Health (distance walked, coffees, sick day, workouts)
- Sleep (sleep/wake time, location, naps)
- Weight (weight, body fat %, muscle mass)
- Happiness (0–100 score, reason, journal entry, day type)
- Work (productivity score, duration, location, commute)
- Technology & social media (phone/laptop usage minutes, Instagram followers/usage)
- Subs — a fixed set of personal subscores tracked daily
- People — up to 7 "positive" and 3 "negative" people slots per day, linked to
  the people catalog
- Places — up to 2 place slots per day, linked to the places catalog
- Entertainment — an open-ended log of what you watched/read/played that day
  (movies, TV episodes, books, sports), each linked back to its catalog entry

**Manage** (`/manage`) — the catalogs that back every day entry, separate from
the "+ New" add flows so there's a dedicated place to fix a typo'd name, merge
duplicates, or retire an old entry:

- **People**, with relationship tags
- **Places**, with categories/subcategories, metro areas, and a world/hierarchy view
- **Exercises**, with focuses and subtypes for structured workout logging
- **Entertainment**, split into:
  - **Movies** — watch log, watchlist, and personal rankings; poster/metadata
    lookup from TMDB
  - **TV shows** — full season/episode tracking: pick a show, drill into a
    season, log individual episode watches, see watch history and a "Next up"
    prompt for what to watch next; metadata from TMDB
  - **Books** — reading sessions, watchlist, and rankings; metadata from
    Google Books
  - **Sports** — leagues, teams, and watches

**Charts** (`/charts`) — D3-driven visualizations over your logged history:

- Happiness distribution (histogram) and happiness trend (monthly average, with a min/max band)
- A zoomable weight-over-time line (brush-to-zoom)
- A yearly sleep-duration calendar heatmap
- Body weight vs. monthly training volume
- Exercise mix — workout count by category/exercise/subtype, with a real date-range slider, period bucketing (week/month/quarter/year), and stacked or proportional (% share) view
- Small multiples of each daily "sub" score over time
- A most-visited-places ranking
- A draggable people-network graph of who gets logged together

This area is being rebuilt incrementally onto a shared D3 toolkit (one
`useD3` hook, a common tooltip/legend/axis/color layer, and a growing family
of reusable `Interactive*` chart primitives) rather than each chart staying
its own one-off component — see `AGENTS.md` for the toolkit's architecture
and the GitHub issues under the visualization epic (#14) for what's shipped
and what's still in progress.

**Auth** — single-user password gate, not a multi-account system. One shared
password (`APP_PASSWORD`) exchanges for a signed session cookie
(`SESSION_SECRET`); a proxy/middleware gate (`src/proxy.ts`) requires a valid
session on every route except `/login` and `/api/auth/*`.

## Tech stack

- **[Next.js 16](https://nextjs.org)** (App Router, React Server Components), **React 19**, **TypeScript**
- **[Drizzle ORM](https://orm.drizzle.team)** over **[Neon](https://neon.tech)** serverless Postgres (`@neondatabase/serverless`)
- **Tailwind CSS v4** (CSS-first config — no `tailwind.config.js`; theme tokens live in `src/app/globals.css`)
- **shadcn/ui** components on **Base UI** primitives (`components.json`, `style: "base-nova"`), icons from **lucide-react**
- **D3.js** for the chart layer — a shared `useD3` hook, common tooltip/legend/axis/color/formatting utilities, and reusable `Interactive*` chart primitives (`src/hooks/use-d3.ts`, `src/lib/viz/`, `src/components/charts/`) — see `AGENTS.md` for how this toolkit is put together
- Metadata sourced from **TMDB** (movies/TV) and **Google Books** (books) at add-time

## Getting started

### Prerequisites

- Node 22 (matches CI's `actions/setup-node@v4` config and the version this
  was developed against)
- A Postgres database to point at — in practice a [Neon](https://neon.tech)
  project, since the schema, migration workflow, and CI are all built around
  Neon's branching model (see [Database & environments](#database--environments) below)

### Install

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` (see [Environment variables](#environment-variables)
below) — at minimum `DATABASE_URL`, `APP_PASSWORD`, and `SESSION_SECRET` are
required for the app to boot.

Push the schema to your database (there's no migrations directory — Drizzle
pushes `src/db/schema.ts`'s shape directly):

```bash
npx drizzle-kit push
```

Then run the dev server:

```bash
npm run dev
```

and open [http://localhost:3000](http://localhost:3000). Log in with
whatever you set `APP_PASSWORD` to.

If you're working on a PR that changes the schema, prefer `npm run dev:pr`
instead of pointing `.env.local` at a shared database by hand — it looks up
the disposable Neon branch CI already created for your current branch's PR
(see [Database & environments](#database--environments)) and rewrites
`DATABASE_URL` in `.env.local` to match before starting `next dev`.

### Environment variables

All of these are documented inline in `.env.example`; summarized here:

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres/Neon connection string the app reads and writes against. |
| `QA_DATABASE_URL` | Vercel only | Fallback DB for a Preview Deployment with no open PR yet (see `src/instrumentation.ts`). Unused locally. |
| `PROD_DB_HOSTS` | Recommended | Comma-separated hostname(s) of your production Neon database. Not a secret — lets `scripts/lib/prod-guard.mjs` recognize when a write script is pointed at prod and demand typed confirmation instead of writing silently. |
| `APP_PASSWORD` | Yes | The single shared login password; also doubles as the confirmation password `prod-guard.mjs` asks for before a script writes to production, if set. |
| `SESSION_SECRET` | Yes | Random secret used to sign session cookies. Generate with `openssl rand -hex 32`. |
| `TMDB_API_KEY` | For movie/TV metadata lookup | [TMDB](https://www.themoviedb.org/documentation/api) API key, used by `/api/tmdb/*`. |
| `GOOGLE_BOOKS_API_KEY` | For book metadata lookup | Google Books API key, used by `/api/google-books/*`. |

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server. |
| `npm run dev:pr` | Point `.env.local` at the current branch's PR database (from the Neon-branch-per-PR CI workflow), then start `next dev`. |
| `npm run build` / `npm run start` | Production build / start. |
| `npm run lint` | ESLint. |
| `npm run migrate:history` | One-time historical import from the legacy Firestore app into this Postgres schema (needs `firebase-admin`, a service-account key, and network access to both Firestore and Neon — see the script's header comment). Dry-run by default; `--commit` to write. |
| `npm run migrate:entertainment-kinds` | Backfills the `entertainment_kinds` table and `entertainment_catalog.kind_id` for databases created before that schema change. Dry-run by default; `--commit` to write. |
| `npm run backfill:place-paths` | Recomputes materialized place-hierarchy paths. Dry-run by default; `--commit` to write. |
| `npm run diagnose:place-cycles` | Read-only check for cyclical parent/child relationships in the places hierarchy. |
| `npm run split:duplicate-places` | Splits merged/duplicate place records apart. Dry-run by default; `--commit` to write. |

Every write-capable script here runs through `scripts/lib/prod-guard.mjs`,
which checks the active `DATABASE_URL`'s hostname against `PROD_DB_HOSTS`
and, if it matches, requires typed confirmation (and `APP_PASSWORD`, if set)
before anything is written.

## Database & environments

The schema lives entirely in `src/db/schema.ts` — there's no migrations
directory; `drizzle-kit push` diffs the live database against that file
directly. The project is built around a few distinct Neon branches, wired
together by the workflows in `.github/workflows/`:

- **`main`** — production data. Deploys to Vercel Production on every push to
  `main`. Schema changes are applied by `migrate-prod.yml`, which pauses
  behind a required-reviewer approval gate (a GitHub Environment named
  `production`) before running `drizzle-kit push --force`, and opens a
  tracking issue so the pending approval doesn't get missed.
- **`qa`** — a standing branch reset from production once a day
  (`qa-branch-refresh.yml`), used as the parent for every PR's disposable
  branch and as the fallback database for stray Preview Deployments.
- **A branch per open PR** — `pr-db-branch-create.yml` creates (and
  `pr-db-branch-delete.yml` later deletes) a disposable Neon branch for every
  PR into `main`, branched from `qa`, with that PR's `schema.ts` already
  pushed to it. The connection string is posted as a PR comment; `npm run
  dev:pr` reads that comment to point local dev at it, and
  `src/instrumentation.ts` does the equivalent at cold-start for that PR's
  actual Vercel Preview Deployment (so a PR that changes the schema doesn't
  500 against QA's stale one).

`ci.yml` runs on every PR into `main`: lint, `next typegen` + `tsc --noEmit`,
and a `next build` against the QA database (every page in the app is
`export const dynamic = "force-dynamic"`, so the build itself never queries
the database — but a few modules read env vars at import time, so real
values are still needed for the build not to fail).

## Project structure

```
src/
  app/
    day/[date]/        Daily log pages, one route per category
    manage/            Catalog CRUD — people, places, exercises, entertainment
    charts/            D3 chart pages
    api/                REST-ish route handlers backing the above
    login/              Password login page
  components/
    ui/                 shadcn/ui primitives
    charts/             D3 chart components and pages
      interactive/       Shared Interactive* chart primitives, axis/mark/tooltip/
                          legend helpers, and reusable filter controls
    manage/              Catalog detail/edit UI
  db/
    schema.ts            Full Drizzle schema — the source of truth for the DB shape
  hooks/
    use-d3.ts             The D3-in-React render hook every chart uses
  lib/
    viz/                  Chart-agnostic formatting/color/binning helpers
    ...                   Data-access helpers, auth, date utilities
  instrumentation.ts      Vercel Preview Deployment DB-branch resolution (see above)
  proxy.ts                Auth gate (Next.js middleware)
scripts/                  Standalone maintenance/migration scripts (see Scripts above)
```

See `AGENTS.md` for a fuller walkthrough of the chart toolkit's architecture
and the conventions this codebase follows (issue/PR workflow, color rules,
verification expectations) — worth reading before picking up any chart work.

## Deployment

Deploys to [Vercel](https://vercel.com), with the Neon Vercel integration
managing per-preview database branches as described above. Production
deploys happen on push to `main`, gated by `migrate-prod.yml`'s approval step
for any schema change.
