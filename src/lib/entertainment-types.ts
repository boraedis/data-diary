import { categoricalColor } from "@/lib/viz/color";

// The entertainment "type" vocabulary shared by the leaderboard (#115) and
// the trend chart (#479). Its own module, rather than exported from
// `src/lib/leaderboards/entertainment.ts`, because the trend's client
// component needs the labels and colours, and that file imports the
// database client.

/** The five dedicated domains, in their fixed colour-slot order, then
 * "other" for every user-added kind. The order is the categorical palette
 * assignment, so it never changes with the data (see viz/color.ts). */
export type EntertainmentType = "movie" | "tv" | "book" | "sports" | "game" | "other";

export const ENTERTAINMENT_TYPE_LABELS: Record<EntertainmentType, string> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  sports: "Sports",
  game: "Games",
  other: "Other",
};

export const ENTERTAINMENT_TYPE_ORDER: EntertainmentType[] = ["movie", "tv", "book", "sports", "game", "other"];

/** Slot colour for a type; "other" gets none rather than a sixth hue. */
export function entertainmentTypeColor(type: EntertainmentType): string | null {
  const index = ENTERTAINMENT_TYPE_ORDER.indexOf(type);
  return index < 5 ? categoricalColor(index) : null;
}

/** Maps a seeded system kind onto its dedicated type, for any historical
 * generic-catalog entries logged before the dedicated tables existed. */
const SYSTEM_KIND_TYPES: Record<string, EntertainmentType> = {
  movie: "movie",
  "tv show": "tv",
  book: "book",
  sport: "sports",
  game: "game",
};

/** The type a generic `entertainment_entries` row counts under: its system
 * kind's dedicated type, else "other". */
export function genericEntryType(kind: string, isSystem: boolean): EntertainmentType {
  return isSystem ? (SYSTEM_KIND_TYPES[kind.toLowerCase()] ?? "other") : "other";
}
