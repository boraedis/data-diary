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
  | `InteractiveLine` | shipped | #18 | weight, happiness-trend |
  | `InteractiveHist` | shipped | #20 | happiness distribution |
  | `InteractiveCalendar` | shipped | #21 | sleep calendar |
  | `InteractiveArea` | shipped | #19 | exercise mix |
  | `InteractiveNetwork` | not started | #23 | (people network still bespoke) |
  | `InteractiveBar`/`Ranked` | not started | #22 | (places leaderboard still bespoke) |
  | Geo/Choropleth | not started | #24 | — |
  | Migrate remaining chart pages onto the primitives above, delete old bespoke components | not started | #25 | — |

  Also in this folder: small shared **filter controls** built for #19
  (`PeriodPicker`, `TimeRangePicker`, `GroupByPicker`) — generic, reusable
  across any chart that buckets by date, filters by range, or drills into a
  dimension, not one-off UI wired to a single chart.
- **`src/components/charts/chart-page.tsx`** / **`chart-card.tsx`** — the
  shared page shell (title, back link, filters row) and card wrapper every
  `/charts/*` page uses.

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

## Where the epic stands

`main` currently has #16-#21 and #19 merged (formatting/color utilities,
shared tooltip/crosshair/legend/mark-specs, InteractiveLine, InteractiveHist,
InteractiveCalendar, InteractiveArea, and their proving-case chart pages).
Next up in the epic's locked build order (see #14): **#23**
(InteractiveNetwork) → **#22** (InteractiveBar/Ranked) → **#24**
(Geo/Choropleth, flagged as the heaviest lift) → **#25** (migrate the
remaining bespoke chart pages onto the finished primitives and delete the
old components). Each is workable independently — check the issue itself
for its own scope/API-shape notes before starting.

<!-- END:repo-development-guide -->
