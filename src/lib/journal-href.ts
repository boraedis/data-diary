/** URL builder for /journal's filter state (issue #288).
 *
 * Its own module rather than a function in `src/lib/journal.ts` because
 * the search box is a client component: journal.ts reaches for `getDb()`
 * at import time, and pulling the database client into the browser bundle
 * to share one query-string helper would be a bad trade. Both sides
 * import this instead, so the param names (`q`, `year`, `page`) are
 * spelled once.
 *
 * Empty/default values are omitted rather than serialised as empty
 * params, so plain browsing stays on a clean `/journal`.
 */
export function journalHref({
  search,
  year,
  page,
}: {
  search?: string;
  year?: string;
  page?: number;
} = {}): string {
  const params = new URLSearchParams();
  const term = search?.trim();
  if (term) params.set("q", term);
  if (year) params.set("year", year);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/journal?${query}` : "/journal";
}
