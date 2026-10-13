// Season names are free text (a sports_seasons row is just a name per
// league), but in practice they're "2025-26", "2024-25" or a bare "2024" —
// see scripts/seed-pr-fixture.mjs. There's no start date to sort on, so the
// leading year orders them, and the full name breaks ties so "2025-26" comes
// after "2025". A name with no leading year (e.g. "Spring") sorts oldest, so
// it never shadows a dated season as the default.

function leadingYear(name: string): number {
  const match = /^\d{4}/.exec(name.trim());
  return match ? Number(match[0]) : -1;
}

/** Comparator for newest-first ordering of season names. */
export function compareSeasonsNewestFirst(a: string, b: string): number {
  return leadingYear(b) - leadingYear(a) || b.localeCompare(a, undefined, { numeric: true });
}

/** The season a new watch should default to, or null when there are none. */
export function latestSeasonName(names: string[]): string | null {
  if (names.length === 0) return null;
  return [...names].sort(compareSeasonsNewestFirst)[0];
}
