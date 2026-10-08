/**
 * One sports watch as display text, away team first (#583): "Away @ Home",
 * the American convention (scoreboards, schedules, box scores all list the
 * visitor on top) — this app's leagues are almost entirely US ones, so
 * "Home vs Away" read backwards every time. Storage is unchanged; only the
 * order things are shown and entered in follows it.
 *
 * Falls back to whichever single name exists: an individual sport only
 * fills the home slot (its "Athlete"), and a team deleted out from under a
 * watch nulls its side (onDelete: set null).
 */
export function formatMatchup(awayName: string | null | undefined, homeName: string | null | undefined): string | null {
  if (awayName && homeName) return `${awayName} @ ${homeName}`;
  return homeName ?? awayName ?? null;
}
