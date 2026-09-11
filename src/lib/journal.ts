import { and, count, desc, gte, ilike, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { days } from "@/db/schema";

// Reading surface for `days.journal` — the per-day long-form free text
// (issue #288). Everything else in this app reads a day one date at a
// time (src/lib/days.ts's loadDay) or aggregates days into a chart
// series; this is the one place that treats the journal column as a
// corpus to page through and search across.
//
// Deliberately its own module rather than more functions on days.ts:
// that file is the day-entry *write/edit* domain (payload parsing,
// validation, per-section saves) and is already ~4k lines. Nothing here
// writes.

/** Entries per page. A journal entry is a paragraph or several, so this
 * is much smaller than a catalog list's page would be — 25 renders as a
 * readable column rather than a wall. */
export const JOURNAL_PAGE_SIZE = 25;

export type JournalEntry = {
  date: string; // "YYYY-MM-DD"
  journal: string;
};

export type JournalYearFacet = {
  year: string; // "2026"
  entryCount: number;
};

export type JournalPage = {
  entries: JournalEntry[];
  /** Entries matching the current query + year, across every page. */
  total: number;
  /** Per-year counts for the current query, ignoring the selected year —
   * standard facet behaviour, so the chips still show you where else
   * your search matched rather than collapsing to the year you're in. */
  years: JournalYearFacet[];
  page: number;
  pageCount: number;
};

export type JournalQuery = {
  search?: string;
  year?: string;
  page?: number;
};

/**
 * Escapes the characters Postgres `LIKE`/`ILIKE` treats as wildcards so a
 * search for "100%" or "a_b" matches that literal text instead of acting
 * as a pattern. Backslash first, or it would double-escape the escapes
 * this adds. Postgres's default LIKE escape character is the backslash,
 * so no explicit `ESCAPE` clause is needed.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type JournalTextSegment = { text: string; match: boolean };

/**
 * Splits `text` into alternating non-matching/matching runs of `query`,
 * for rendering search hits as `<mark>` without putting user input
 * anywhere near a regex or `dangerouslySetInnerHTML`. Matching is
 * case-insensitive and literal — a query of "c++" or "(a)" searches for
 * those characters, not a pattern.
 *
 * Falls back to a single unhighlighted segment when lowercasing changes
 * the string's length (a handful of Unicode characters, e.g. "İ", expand
 * to two code units in lowercase), since the offsets found in the
 * lowercased copy would no longer line up with the original text. Losing
 * the highlight on such an entry is a much smaller problem than slicing
 * its text at the wrong index.
 */
export function splitOnMatches(text: string, query: string): JournalTextSegment[] {
  const term = query.trim();
  if (!term) return [{ text, match: false }];

  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  if (haystack.length !== text.length || needle.length === 0) return [{ text, match: false }];

  const segments: JournalTextSegment[] = [];
  let cursor = 0;
  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;
    if (at > cursor) segments.push({ text: text.slice(cursor, at), match: false });
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments.length > 0 ? segments : [{ text, match: false }];
}

/** A day counts as having a journal entry only if it holds something
 * other than whitespace — a day saved with the journal box focused but
 * never typed into stores "" or a stray newline, and those shouldn't
 * show up as entries to read. */
const HAS_JOURNAL: SQL = sql`${days.journal} IS NOT NULL AND btrim(${days.journal}) <> ''`;

/** Year as a string, off the date column — grouped on and ordered by in
 * the facet query below, so it's defined once rather than repeated in
 * three clauses that have to agree. */
const YEAR_EXPR = sql<string>`to_char(${days.date}, 'YYYY')`;

function searchCondition(search: string | undefined): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  return ilike(days.journal, `%${escapeLikePattern(term)}%`);
}

/** Calendar-year bounds as plain date strings — a range comparison
 * rather than `date_part('year', ...) = n`, so the primary key index on
 * `days.date` is still usable. */
function yearCondition(year: string | undefined): SQL | undefined {
  if (!year || !/^\d{4}$/.test(year)) return undefined;
  return and(gte(days.date, `${year}-01-01`), lte(days.date, `${year}-12-31`));
}

/**
 * One page of journal entries, newest first, plus the totals the UI needs
 * to render pagination and the year chips.
 *
 * Search is a case-insensitive substring match (`ILIKE '%term%'`), not
 * Postgres full-text search: at this app's scale (one row per logged day,
 * single user) the sequential scan is cheap, and substring matching finds
 * partial words and punctuation that `to_tsvector` stemming would drop —
 * searching a personal journal for "birthd" or ":)" should work. Moving
 * to a tsvector column with a GIN index is the upgrade path if this ever
 * gets slow, and is why the search term is escaped/parameterised here
 * rather than interpolated.
 */
export async function getJournalPage({ search, year, page = 1 }: JournalQuery = {}): Promise<JournalPage> {
  const db = getDb();

  const searchWhere = searchCondition(search);
  const yearWhere = yearCondition(year);
  const listWhere = and(HAS_JOURNAL, searchWhere, yearWhere);
  // Facets intentionally skip `yearWhere` — see JournalPage.years.
  const facetWhere = and(HAS_JOURNAL, searchWhere);

  const [[totalRow], yearRows] = await Promise.all([
    db.select({ n: count() }).from(days).where(listWhere),
    db
      .select({ year: YEAR_EXPR, entryCount: count() })
      .from(days)
      .where(facetWhere)
      .groupBy(YEAR_EXPR)
      .orderBy(desc(YEAR_EXPR)),
  ]);

  const total = totalRow?.n ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / JOURNAL_PAGE_SIZE));
  // Clamp rather than 404 on an out-of-range page: the page number can go
  // stale just by editing the search box, and landing on the last page of
  // the new result set reads better than an error.
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);

  const rows = await db
    .select({ date: days.date, journal: days.journal })
    .from(days)
    .where(listWhere)
    .orderBy(desc(days.date))
    .limit(JOURNAL_PAGE_SIZE)
    .offset((safePage - 1) * JOURNAL_PAGE_SIZE);

  return {
    entries: rows.map((r) => ({ date: r.date, journal: r.journal as string })),
    total,
    years: yearRows.map((r) => ({ year: r.year, entryCount: r.entryCount })),
    page: safePage,
    pageCount,
  };
}
