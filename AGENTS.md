<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:repo-development-guide -->

# Working in this repo

Data Diary is a from-scratch Next.js/Postgres rebuild of a personal,
single-user life-logging app (see README.md for the full feature list,
install steps, and environment). This section is context for anyone (human
or AI agent) picking up work here across sessions — condensed from the
in-progress chart-rebuild epic, where most of this repo's real conventions
were established.

## Where to look first

- **README.md** — features, install, env vars, scripts, DB/environments, deployment.
- **GitHub issue #14** — the chart-rebuild epic. Its pinned comment has the
  locked-in design decisions (drill-down scope, zoom/pan modes, color
  rules) and the sub-issue build order — read it before touching anything
  under `src/components/charts/`.
- **GitHub issue #12** — the external-landing-page epic (sub-issues
  #82-#87, all merged). Its comment thread has the locked-in decisions on
  what's public vs. masked — read it before touching `src/proxy.ts`'s
  public paths or anything under `src/lib/public-*.ts`. **Issue #96**
  tracks follow-up work on this area (more public chart types, an actual
  edit UI for `projectSettings`, a project version timeline, a copy pass).
- Each closed sub-issue's own final comment documents what actually
  shipped against its acceptance criteria, and flags anything unverified —
  more reliable than the issue's original scope text, which sometimes
  changes during implementation.

## The chart/visualization toolkit

Built incrementally as GitHub issues #16-#25 (all part of epic #14).
Current shape:

- **`src/hooks/use-d3.ts`** — the one D3-in-React pattern this app uses:
  `useD3(renderFn, deps)` clears and fully rebuilds a `<svg>` from scratch
  whenever `deps` changes, rather than a D3 enter/update/exit join. Charts
  re-render on a real data/dimension change, not per animation frame, so
  there's nothing worth preserving between renders. **State that changes on
  every pointer move (hover position, drag) must stay out of `deps`** —
  drive it with direct D3 DOM manipulation inside event handlers instead of
  React state, or every pointermove triggers a full SVG rebuild. React
  state is fine for driving separately-rendered UI (a `<ChartTooltip>`)
  that doesn't touch `useD3`'s own dependency array.
- **`src/components/charts/responsive-chart.tsx`** — measures its
  container via `ResizeObserver` and hands `{width, height}` down; the
  container's height comes from a CSS class, not a prop. Every chart page
  in this app uses the same class, `h-[min(62vh,640px)] min-h-[320px]` —
  match it for a new chart rather than picking an arbitrary size (a past
  chart shipped with a smaller, inconsistent class and needed a follow-up
  fix).
- **`src/lib/viz/`** — pure, non-visual helpers every chart should use
  instead of hand-rolling: `format.ts` (dates/durations/numbers — no
  epoch-day math, plain `Date`/"YYYY-MM-DD" strings only, see
  `src/lib/date.ts`), `color.ts` (`categoricalColor(i)` — **fixed slot
  order, never cycled**, only 5 real slots before it flattens to one muted
  gray for every index beyond that; `sequentialScale`/`divergingScale`),
  `bin.ts` (`groupByPeriod` — re-bucketing an *already-fetched* series by
  week/month/quarter/year; bulk aggregation over a chart's full history
  belongs in SQL, not here — see that file's own header for the reasoning).
- **`src/components/charts/interactive/`** — the shared interactive/visual
  layer: `axis.ts` (`drawStandardAxes`, `drawYGridlines`), `marks.ts`
  (`MARK_SPECS` constants + `roundedBarPath`/`attachMarkHover`),
  `tooltip.tsx` (`ChartTooltip`, `useCrosshair` for a shared-x hover
  model), `legend.tsx` (`Legend`, with optional click-to-toggle), plus the
  `Interactive*` primitive family itself:

  | Primitive | Status | Issue | Real consumer |
  |---|---|---|---|
  | `InteractiveLine` | shipped | #18 | happiness-trend |
  | `InteractiveHist` | shipped | #20 | happiness distribution |
  | `InteractiveCalendar` | shipped | #21 | sleep calendar |
  | `InteractiveArea` | shipped | #19 | exercise mix |
  | `InteractiveNetwork` | shipped | #23 | people network |
  | `InteractiveBar`/`Ranked` | shipped | #22 | places leaderboard |
  | Geo/Choropleth | shipped | #24 | world map |
  | Migrate remaining chart pages onto the primitives above, delete old bespoke components | shipped | #25 | — |
  | `InteractiveScroller` | shipped | #117 | weight |
  | `InteractiveDonut` (zoomable sunburst) | shipped | #118 | place hierarchy |
  | `InteractiveTimeline` | not started | #119 | — |

  `InteractiveDonut` is the only primitive here that takes a *tree* rather
  than a series — its input shape and the pure builders for it live in
  **`src/lib/viz/hierarchy.ts`** (`buildTreeFromParents` for a
  self-referencing table like `places.parentId`, `buildTreeFromLevels` for
  a fixed category/subcategory ladder, plus `pruneEmptyBranches` and
  `foldTailIntoOther`). Same boundary as `bin.ts`: re-shaping rows a page
  already fetched, never bulk aggregation.

  Also in this folder: small shared **filter controls** built for #19
  (`PeriodPicker`, `TimeRangePicker`, `GroupByPicker`) — generic, reusable
  across any chart that buckets by date, filters by range, or drills into a
  dimension, not one-off UI wired to a single chart.
- **`src/components/charts/chart-page.tsx`** / **`chart-card.tsx`** — the
  shared page shell (title, back link, filters row) and card wrapper every
  `/charts/*` page uses.

## The public landing page

Built as GitHub issue #12 (sub-issues #82-#87, all merged) — a curated,
unauthenticated front door at `/`, separate from the private, single-user
app everything else in this codebase serves. Follow-up work lives on #96.

- **`src/proxy.ts`** — the session gate. A `PUBLIC_PATHS` set (exact
  matches) plus a couple of prefix checks (`/public-charts/`,
  `/api/public/`, `/api/auth/`) are the *only* unauthenticated surface.
  Adding a new public page means adding it here explicitly — nothing is
  public by omission. `/robots.txt` had to be added the same way: it's a
  Next.js metadata route (`src/app/robots.ts`), not exempt from the proxy
  just because it's a special file convention.
- **`src/lib/public-profile.ts`** / **`src/lib/public-charts.ts`** — the
  data boundary. Every function here is its own narrow, explicit
  include-list query, never a passthrough of the private
  `src/lib/profile.ts`/`src/lib/charts.ts` functions — a field added to
  the private domain doesn't leak onto the public site just because it
  exists there. Permanently excluded: exact address/lat-lng, the
  relationship timeline, all "subs" scores, and per-day free text.
  `getPublicLandingData` is wrapped in React's `cache()` so a page and its
  `generateMetadata` share one DB call per request instead of two.
- **`src/lib/public-content.ts`** — `PUBLIC_CHART_TYPES`, the curated,
  hardcoded list of which chart types get a public page. Deliberately not
  a general "publish this chart" flag/admin UI — add a chart type here and
  give it a route under `src/app/public-charts/` when it should go public.
- **DB vs. repo content split** (locked in on #12): short, structured
  facts (project name/tagline/goals) live in the `projectSettings` table
  (`src/lib/project.ts`, mirroring `profileSettings`'s singleton-row
  pattern) so they're editable without a deploy — though no edit UI exists
  for it yet, tracked on #96. Long-form prose (`/about-project`'s body,
  the hero's descriptive copy) is hand-authored directly in the repo, not
  a DB column.
- Public pages: `/` (hero + the 3 legacy stat tiles), `/about-project`,
  `/about-me` (placeholder — "to be filled out eventually" is intentional,
  not unfinished work), `/public-charts` (a nav index, same card-grid
  pattern as the private `/charts`) and its per-chart routes. Each
  individual public chart page mirrors its private counterpart's own
  page/shell almost exactly, just fed by the public data layer instead.
- **`src/components/coming-soon-page.tsx`** — the stub a future public
  link should render until its own real page exists. Not currently
  instantiated anywhere (every current public link has real content), but
  keep it for the next one — it exists because a hero link to a
  real-but-unbuilt path was falling through `proxy.ts` into the login
  redirect instead of a normal 404, which reads as "why is this asking me
  to log in" to a visitor who was never meant to authenticate at all.

## Conventions this codebase leans on

- **Comments explain *why*, not just *what*.** Nearly every non-obvious
  constant, API shape, or omitted feature has a doc comment saying the
  reasoning and, where relevant, what was explicitly *not* done and why
  (e.g. why a group-by dimension was left out because it would double-count
  data). Match that density in new code here — a future session (or
  reviewer) shouldn't have to reconstruct intent from the diff alone.
- **Color**: categorical hues are assigned by fixed index order and never
  regenerated/cycled/repainted when a series is filtered out. A palette
  change gets run through the dataviz skill's `validate_palette.js`
  (colorblind-safety, contrast, lightness) before it's trusted — see #16's
  final comment for the last full validation record.
- **One GitHub issue → one branch → one PR**, with `Closes #N` in the PR
  body. Follow-up feedback on work already in an open PR lands as new
  commits on that **same** branch — never a new branch/PR — until it
  merges. Once a PR merges, further changes need a fresh branch/PR even if
  they're "more of the same feature" (see the squash-merge note below for
  why this matters mechanically, not just procedurally).
- After opening or meaningfully updating a PR, post a comment on its linked
  issue summarizing what shipped, mapped against the issue's acceptance
  criteria — and note explicitly what couldn't be verified.
- **Verification is `npx tsc --noEmit` + `npx eslint .`** — both must be
  clean before a commit. Several past sessions on this repo had no
  browser/network available to actually render/exercise a chart; every one
  of them said so explicitly in the PR/comment rather than implying visual
  behavior (hover states, drag, real layout) had been confirmed. Keep doing
  that — an honest "unverified" note is worth far more than silence.
- **Squash-merge gotcha**: this repo's PRs merge via GitHub's squash
  merge, which creates a brand-new commit on `main` — none of the feature
  branch's own commits ever become ancestors of `main`, even once
  everything is fully merged. `git merge-base --is-ancestor <branch-commit>
  main` will report `false` for a fully-merged branch; that is expected,
  not a sign of lost work. To check whether a branch's changes actually
  landed, diff trees instead: `git diff <main-tip> <branch-tip> --stat` —
  empty output means the content is fully present on `main`.

## Working with GitHub issues

Every issue in this repo needs **two** labels, not one: a normal type label
(`bug`, `enhancement`, `epic`, `Epic sub-issue`, `UI improvement`, or `idea`)
*and* an effort-size label (`LOE: xs` / `s` / `m` / `l` / `xl` / `xxl`).
When filing a new issue, or triaging one that's missing either, add both —
an issue with only a type label or only an LOE label is incomplete, not
just unlabeled-by-convention.

- `bug` — an existing feature is broken
- `enhancement` — a new capability or non-trivial change
- `UI improvement` — a small, purely visual/interface change, doesn't need
  the weight of `enhancement`
- `epic` — needs to be broken down into sub-issues before it's workable
- `Epic sub-issue` — one piece of an `epic`, linked via `parent`
- `idea` — a loose concept, not yet scoped; no LOE label until it's turned
  into real work

LOE is a rough size estimate for planning, not a hard commitment — pick the
closest bucket rather than agonizing over precision.

## Schema changes and database testing

**Before pushing schema changes and running tests:**

1. **Create the PR first** — schema migrations require a dedicated branch database
   to avoid conflicts and schema validation issues.
2. **Wait for the branch database to be provisioned** — when a PR is created,
   an automated branch database is created and associated with that PR.
3. **Connect to the branch database** — run `npm run dev:pr` to pull the branch
   database URL from the PR environment and connect the local dev server to it.
   This ensures `drizzle-kit push` and tests run against an isolated schema.
4. **Then push schema changes** — only after `npm run dev:pr` is running should
   you execute `npx drizzle-kit push` or similar schema commands.

This workflow prevents schema conflicts between concurrent PRs and local
development. Do not attempt `drizzle-kit push` or schema validation against
your local dev database while working on schema changes — use the PR database
workflow instead.

## Where the epic stands

The original chart-rebuild epic (**#14**) is fully closed — all of #16-#25
shipped: InteractiveLine, InteractiveHist, InteractiveCalendar,
InteractiveArea, InteractiveNetwork, InteractiveBar/Ranked, Geo/Choropleth,
and the migration of every legacy chart page onto those primitives.

A follow-on epic, **#109** (three new primitives — Scroller, Donut,
Timeline — plus a notes/polish pass on every primitive shipped under #14),
is now the active one. `main` has InteractiveScroller (#117) merged, and
InteractiveDonut (#118) shipped as a zoomable multi-ring sunburst (the
single-ring-vs-sunburst question on that issue was resolved in favor of
the sunburst — a plain donut is just `visibleRings={1}`). Still
open: InteractiveTimeline (#119), the subs-chart
rebuild onto Scroller/Line (#120), InteractiveRanked's bar-race mode
(#103), InteractiveGeo's click-into-subdivisions drill-down (#107), and a
per-primitive "notes & polish backlog" sub-issue for each primitive from
the original epic (#110-#116). Each is workable independently — check the
issue itself for its own scope/API-shape notes before starting.

<!-- END:repo-development-guide -->
