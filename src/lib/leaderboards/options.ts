// Picker options for the leaderboard pages (#115). Plain data, shared by
// the server pages (which read the choice from the URL) and the client
// explorer (which writes it back) — no React here, so a server component
// can import it.

export type LeaderboardOption<T extends string = string> = { id: T; label: string };

/** A URL search param, validated against the options it may hold. A
 * missing, repeated or hand-edited value falls back to the first option
 * rather than erroring — the URL is user input. */
export function pickOption<T extends string>(
  value: string | string[] | undefined,
  options: LeaderboardOption<T>[],
): T {
  const raw = Array.isArray(value) ? value[0] : value;
  return options.find((o) => o.id === raw)?.id ?? options[0].id;
}

/** One picker on a leaderboard page. `param` is its URL search param.
 * Pickers are ordered: changing one clears every picker after it, since
 * a sub-picker (a region level) only means something under the mode that
 * showed it. */
export type LeaderboardPicker = {
  param: string;
  label: string;
  value: string;
  options: LeaderboardOption[];
};

/** The Next.js page `searchParams` shape. */
export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
