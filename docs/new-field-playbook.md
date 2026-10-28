# New field addition playbook

Everything a new **daily field** touches, end to end. Written because a
field's consumers are spread across validation, forms, charts, the recap,
the home dashboard, the public site, and (soon) the inconsistency scan, and
nothing in the codebase lists them together. Work through the checklist
top to bottom; each section says whether the touch point is required,
conditional, or a decision you make per field.

Scope: a field that lives on `days` (a column) or on a satellite table
keyed to a day. Catalog-backed values (a list of places, people, sleep
location types) follow the same path plus the management section.

## 0. Decide the shape first

Five answers drive every later step. Write them down in the PR description.

| Question | Why it matters |
|---|---|
| **Which section does it belong to?** (sleep, happiness, health, work, technology, weight, social media, subs, people, places, entertainment, journal) | The section decides the entry form, the day-page tab, the home score slot, the chart category, and the recap section. Adding a field to an existing section is much cheaper than starting a new one. |
| **Shape:** scalar number, nullable tri-state, text, enum, enum array, or catalog FK? | Drives validation and whether a management page is needed. |
| **Unit and range?** (minutes, km, 0–100 score, kg) | Drives the validator bounds, the chart axis, and the scan's range check. |
| **Is `null` "not recorded" or can it mean zero?** | Averages and recap coverage gates depend on it. Nullable columns mean "not recorded"; never coerce a missing value to 0. |
| **Public or private?** | Default is private. Public is an explicit opt-in, never a side effect (see section 9). |

Also decide **when tracking started**. Charts show a "Tracked since" line
from a constant in `src/lib/viz/tracking-span.ts`. Without one, the popup
says "Not yet recorded." for real data.

## Quick checklist

| # | Touch point | Required? | Where |
|---|---|---|---|
| 1 | Schema column | Yes | `src/db/schema.ts` |
| 2 | PR fixture data | Yes | `scripts/seed-pr-fixture.mjs` (`dayColumns`) |
| 3 | Payload type, load, save | Yes | `src/lib/days.ts` |
| 4 | Validator + bounds | Yes | `src/lib/days.ts`, `src/lib/duration-limits.ts` |
| 5 | API route | Only for a new section | `src/app/api/days/[date]/<section>/route.ts` |
| 6 | Entry form field | Yes | `src/components/entry-forms/<section>-entry-form.tsx` |
| 7 | Day page tab + completeness | Yes | `src/app/(app)/day/[date]/<section>/page.tsx`, `src/app/(app)/day/[date]/page.tsx` |
| 8 | Home recent-days score | Decide | `src/lib/home.ts` (`scoreDay`), `src/components/recent-days-scroller.tsx` |
| 9 | Chart data getter | If charted | `src/lib/charts.ts` |
| 10 | Scroller / Trend / Calendar | Usually | `src/components/charts/`, `src/app/(app)/charts/` |
| 11 | Chart catalog entry | If charted | `src/lib/charts-catalog.ts` |
| 12 | Methodology, tracking span, interaction guide | If charted | `src/lib/viz/methodology.ts`, `tracking-span.ts`, `interaction-guides.ts` |
| 13 | Recap | Decide | `src/lib/recap-*.ts`, `src/components/recap/` |
| 14 | Inconsistency scan | Decide, and register once #13 lands | See section 7 |
| 15 | Management pages | Catalog-backed only | `src/app/(app)/manage/`, `src/components/manage/` |
| 16 | Public site | Decide, default no | `src/lib/public-content.ts`, `src/lib/public-charts.ts`, `src/lib/public-profile.ts` |
| 17 | Other day readers | Check each | Section 10 |
| 18 | Copy: README, about page | If user-facing | `README.md`, `src/app/about-project/page.tsx` |
| 19 | Tests and verification | Yes | Section 11 |

## 1. Schema

- Add the column to `days` in `src/db/schema.ts`, in the matching
  `// --- Section ---` block. Comment the non-obvious bits the way the
  neighbouring columns do (units, tri-state meaning, why it's not an FK).
- There are no migrations. `drizzle-kit push` diffs the live database
  against `schema.ts`. For production, the change lands through
  `migrate-prod.yml` after approval. See the README's "Database &
  environments" section.
- Schema changes go through a PR and its own `pr-<N>` branch database.
  Run `npm run dev:pr` before any `drizzle-kit push` (see AGENTS.md,
  "Schema changes and database testing"). Never push to your local dev
  database for schema work.
- Satellite table instead of a column? Only when the value repeats per
  day (a list of sessions, sets, or watches). A fixed per-day value is a
  column. Follow the replace-on-save pattern in `src/lib/duration-limits.ts`.

## 2. PR fixture data

`scripts/seed-pr-fixture.mjs` builds the fixture every PR database gets
(see the README's note on `seed:pr-fixture`). It lists `dayColumns`
explicitly. Add the new column there and generate a value for it, or
previews will show the field empty and charts will look untested.

Only touch `scripts/migrate-history.mjs` if the field needs a historical
backfill from the legacy export.

## 3. Payload, load, save (`src/lib/days.ts`)

For the field's section, update four things in `src/lib/days.ts`:

1. The `<Section>Payload` type (around lines 136–390).
2. `loadDay`, which maps the row into the `DayPayload` the page reads
   (around line 720 for the work fields). Forgetting this is the most
   common cause of a field that saves but never reappears.
3. `validate<Section>Payload` (section 4).
4. `save<Section>`. It upserts with `onConflictDoUpdate` on `days.date`
   and returns `loadDay(date)`. Put the new column in both the `values`
   and the `set` objects.

## 4. Validation

- Reject what the form can't express and what the database can't hold.
  Non-numeric input, out-of-range values, unknown enum values, and
  missing conditional requirements all belong here, with a message that
  names the field.
- Use `isPercent` for 0–100 scores (happiness, productivity). Use
  `MAX_DAILY_MINUTES` for durations. The cap is 24 hours, and the helper
  in `src/lib/duration-limits.ts` is shared with the entry forms so both
  catch the same bad value.
- Keep validators pure where possible, so the same rules can run in the
  form and on the server. The validators in `days.ts` already follow this.
- Add a test. `src/lib/days-validation.test.ts` covers some of the
  validators. `validateWorkPayload` and `validateTechnologyPayload` have
  no unit tests, so a new validator in those sections should not be the
  first one left untested.

For a day-level minutes column, use `parseDayMinutes` and
`checkDayMinutes` (`src/lib/duration-limits.ts`). They enforce whole
minutes from 0 up to a day, and reject a non-number instead of saving it
as null. Don't copy the older `typeof b.x === "number" ? b.x : null`
pattern into a new field. It drops a mistyped value without an error. The
work and technology validators were moved to these helpers, but several
older validators still use the old pattern (`validateWeightPayload` and
`validateSocialMediaPayload`, for example), so check each one you touch.

## 5. API route (new sections only)

Existing sections already have a route: `src/app/api/days/[date]/<section>/route.ts`.
It validates the body, calls `save<Section>`, and returns the saved day.
A field added to an existing section needs no route change. A new section
needs a route modelled on the work route: `PATCH`, `isValidDateString`,
`validate`, `save`, and a 400 on validation failure.

## 6. Entry form

- The field goes into `src/components/entry-forms/<section>-entry-form.tsx`.
  The form PATCHes `/api/days/${date}/<section>` (the work form does this
  at its line 79).
- Mirror the server rules on the client so the user sees the error before
  submit. Import the shared helpers rather than duplicating constants.
- A new section gets a new form plus its route under
  `src/app/(app)/day/[date]/<section>/page.tsx`. Follow the existing
  section folders.

## 7. Completeness, and the home recent-days bar

This is where the app currently has **three separate definitions of
"filled in"**, and they disagree. Decide the field's status in all of them.

1. **Day overview** (`src/app/(app)/day/[date]/page.tsx`). Each section
   has a `filled` array and a `total`. Happiness counts three fields here,
   and Work counts four. Add the new field to its section's `present([...])`
   and bump `total` if it's a new counted slot.
2. **Home recent-days bar** (`src/lib/home.ts`, `scoreDay`). Each section
   scores 0 or 1 from a few columns, for a 0–10 total. The recent-days
   query at the bottom of `getHomeDashboardData` selects columns by name,
   so a new column used in `scoreDay` must also be added to that select
   list and to the `scoreDay` parameter type. The `loggedResult` count is a
   third, separate list of columns.
3. **Bar width** (`src/components/recent-days-scroller.tsx`, around line
   18). It hardcodes `score / 10`. A new scored section changes the total,
   so update this divisor too. The `scoreDay` comment says "10 sections"
   and will need the same change.

Choose per field:

- **Adding a field to an existing section:** usually the section's bar
  doesn't change. Add it to the day page `filled` only if it is a
  meaningful signal for completeness.
- **Adding a new section:** it changes the denominator. Update
  `scoreDay`, the select list, the divisor, and the comment together.

The three definitions should eventually come from one place. That is the
shared expected-fields registry from issue #13. Until it exists, keep all
three in sync by hand in the same PR.

## 8. Charts

Use the standard set for a daily field: a **Scroller** (`DailyExplorer`,
which wraps `InteractiveScroller`), a **Trend** (`TrendExplorer`), and a
**Calendar** (`CalendarExplorer`). Add others only where the data calls for
them. `src/components/charts/work-charts.tsx` is the reference for the
standard three. `work-happiness-chart.tsx` is the example of a chart that
groups one field by another.

- **Data getter** in `src/lib/charts.ts`, shaped like `getWorkDays` or
  `getCoffeeDailyData`. Follow the rule in `src/lib/viz/bin.ts`: bulk
  aggregation over full history belongs in SQL. `src/lib/viz/` helpers
  only re-bucket data a page has already fetched.
- **Route** under `src/app/(app)/charts/<slug>/page.tsx`. Server components
  fetch and pass plain data to a client chart component. Set
  `export const dynamic = "force-dynamic"`, as the other chart pages do.
- **Component** in `src/components/charts/<section>-charts.tsx`. Use the
  `ChartPage` / `ChartCard` shell and `ResponsiveChart` with the shared
  height class `h-[min(62vh,640px)] min-h-[320px]`.
- **Colour:** categorical hues use `categoricalColor(i)` in fixed slot
  order. Don't cycle them.
- **Axis:** non-negative measures never show a negative axis. Auto-fit
  domains go through `padDomain`, which floors at zero. A ±spread band
  must be clipped at zero before it reaches the domain, as
  `TrendExplorer` and training volume do.
- **Reference lines:** a daily target (like the 8h lines on Work and Sleep)
  goes in as a module-level or memoized `referenceLines` array.
- **Catalog:** add an entry to `src/lib/charts-catalog.ts` with the right
  `categories`. The chart appears on `/charts`, its category page, and
  `/charts/all`.
- **Copy:** every charted field needs a methodology constant in
  `src/lib/viz/methodology.ts`, written in the first person like the
  existing ones. It needs a `TrackingSpan` in `src/lib/viz/tracking-span.ts`.
  If the chart's interaction changes (zoom, legend toggle, click), update
  the matching text in `src/lib/viz/interaction-guides.ts` **in the same PR**,
  as AGENTS.md requires.

## 9. Public site (default: no)

Nothing is public by omission. Opting a chart in means these, all explicit:

- Add its type to `PUBLIC_CHART_TYPES` in `src/lib/public-content.ts`.
- Add a public getter in `src/lib/public-charts.ts` with a narrow include
  list. Never pass the private getter through.
- Add a route under `src/app/public-charts/`.
- Check `src/lib/public-profile.ts`, which masks anything private (exact
  addresses, relationships, subs, per-day free text).

Work data is excluded on purpose. The owner's call, recorded in
`public-content.ts`, is that hours and productivity stay private.

## 10. Other readers to check

`from(days)` appears in 19 non-test files. For each one, decide whether the
field should show there. Start with these:

- `src/lib/recap-*.ts` (section 11)
- `src/lib/on-this-day.ts`: the on-this-day page
- `src/lib/journal.ts`: the journal reading surface
- `src/lib/video-journal/` (`finalize.ts`, `hud.ts`): the video journal HUD reads `coffees`
- `src/lib/leaderboards/places.ts` and `src/lib/catalog-admin.ts`

Search for the column name too. `grep -rn "<fieldName>" src scripts` finds
the consumers that don't go through `from(days)`.

## 11. Recap

The recap doesn't pick up new fields automatically. Each card is an
explicit fetcher and section. Decide:

- **Does the field get a card?** If it fits an existing section (health,
  body, work, people and places, subs, entertainment), add a card to that
  section's fetcher and component. If it's a new theme, add a new section
  and wire it into `src/components/recap/recap-report.tsx`.
- **Coverage gating.** `null` means not recorded, so averages are computed
  over logged days only. Use `summarizeDaily` in `src/lib/recap-body.ts`.
  Gate each average on `MIN_DAYS_FOR_AVERAGE` (14, in `src/lib/recap.ts`)
  and each total on `MIN_DAYS_FOR_TOTAL` (1). A period before the field was
  tracked then shows "not enough data" rather than a confident zero. The
  work fetcher in `src/lib/recap-work.ts` explains this in its header.
- **Narrative.** Cards that feed the story (`src/lib/recap-story.ts`) need
  their type passed through. Check the story output after adding a card.
- **Direction.** Recap cards are neutral by default. Only say a change is
  good or bad when the owner has decided that for the field.

## 12. Home dashboard, other widgets

Section 7 covers the recent-days bar. The home page also uses
`recentDays` for its other summaries. Check `src/lib/home.ts`'s
`daysLogged` count if the field should count as "a day logged" (the
`loggedResult` query), and whether `percentOfLifeLogged` should change.

## 13. Management pages (catalog-backed fields only)

Scalar fields have no management page. Catalog-backed fields (a value
chosen from a named list, like a place, a person, or a sleep location type)
need:

- A catalog table and API route under `src/app/api/<domain>/`.
- A list and detail view under `src/app/(app)/manage/<domain>/`, using
  `src/components/manage/<x>-manage-list.tsx` and `<x>-detail.tsx`.
- A "new" modal, following `src/components/manage/new-*-modal.tsx`.
- Delete protection. Days reference the catalog with `onDelete: "restrict"`,
  so a referenced item can't be removed. The detail page should say why.
- Catalog-admin rules in `src/lib/catalog-admin.ts`, with a test beside
  `catalog-admin-validation.test.ts`.

## 14. Inconsistency scan (issue #13, open)

The scan doesn't exist yet. When it lands, a new field should only need to
be registered, not hand-wired. Until then, record these facts about the
field in the PR so the scan can be wired up later:

- **Expected-field status.** The scan will decide "expected" from the
  field's own historical fill rate, not a fixed list. Nothing to do now,
  but the field must be a real column so it can be counted.
- **Valid range.** Put the bounds in the validator (section 4). The scan's
  fixed-range check should read the same bounds.
- **Outlier candidate?** A numeric field with a stable personal baseline
  (weight, happiness, productivity) is a rolling-average outlier candidate.
  A count or a mostly-zero field usually isn't. Say which, in the PR.
- **Registry.** Once #13 extracts `scoreDay` into a shared module, the
  field gets registered there and section 7's three lists collapse into
  that one. Until then section 7 is the registry.

## 15. Copy

- `README.md`'s Features list, when the field is a user-visible feature.
- `src/app/about-project/page.tsx`, which describes what is tracked.
  It already mentions productivity.
- Methodology and interaction copy (section 8).

## 16. Verification

Run these before the PR is ready:

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```

- **`npm run build`** is needed as well as `tsc` and `eslint`. A server
  component that imports chart UI can break the RSC boundary without any
  type error. (It's in the project memory as a past miss.)
- **Browser check.** Enter a value on the day page, reload, confirm it
  persists. Check the day overview bar, the home recent-days bar, and each
  chart the field appears on, including an empty state and a period before
  the tracking start. Say in the PR which of these you could not verify.
- **PR issue comment.** After opening or meaningfully updating the PR, post
  a summary on the linked issue mapped to its acceptance criteria, as
  AGENTS.md requires.

## Worked example: `productivity`

It was added as part of #444 and the work section. Its touch points, to
compare against:

- Schema: `days.productivity` in `src/db/schema.ts`.
- Validation: `validateWorkPayload`. Range from `isPercent`.
- Form: `src/components/entry-forms/work-entry-form.tsx`.
- Day page: `src/app/(app)/day/[date]/work/page.tsx`, and the overview's Work bar.
- Home: counted in `scoreDay` as "productivity or work duration".
- Charts: work trend, daily, and calendar, plus work-happiness.
  Methodology is `WORK_METHODOLOGY`, tracking start is `WORK_TRACKING_SPAN`.
- Recap: the work section, with a coverage gate.
- Public: deliberately excluded.
- Fixture: `scripts/seed-pr-fixture.mjs`.
- Copy: `src/app/about-project/page.tsx`.

Note that the work section's **Trend chart lacks a public counterpart by
design**, and the recent-days bar counts it while the day overview counts
four fields. Those are decisions, not mistakes, but this playbook exists so
that the next field makes the same choices on purpose.
