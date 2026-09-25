import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  bookReadingSessions,
  books,
  entertainmentCatalog,
  entertainmentEntries,
  entertainmentKinds,
  gameSessions,
  games,
  movies,
  movieWatches,
  sports,
  sportsLeagues,
  sportsWatches,
  tvEpisodes,
  tvEpisodeWatches,
  tvShows,
} from "@/db/schema";
import { categoricalColor } from "@/lib/viz/color";
import { rankCreditedSessions, type CreditedSession } from "@/lib/leaderboards/sessions";
import type { LeaderboardColumns, LeaderboardRow } from "@/lib/leaderboards/rows";
import type { LeaderboardOption } from "@/lib/leaderboards/options";

// The entertainment leaderboard (#115): time spent on movies, TV, books,
// sports and games, plus the user-added "neutral" kinds (concerts,
// theatre), ranked by type, by title, or by where it happened.
//
// Each dedicated domain keeps its own session table, so this reads all
// six and flattens them into one `EntertainmentSession` list — the same
// "one row shape, many sources" move the leaderboard rows themselves make.
// Every table's duration is fully populated (checked when this was built),
// so hours are hours rather than a mix of real and estimated times.

export type EntertainmentMode = "type" | "title" | "location";

export const ENTERTAINMENT_MODES: LeaderboardOption<EntertainmentMode>[] = [
  { id: "type", label: "By Type" },
  { id: "title", label: "By Title" },
  { id: "location", label: "By Location" },
];

/** The five dedicated domains, in their fixed colour-slot order, then
 * "other" for every user-added kind. The order is the categorical palette
 * assignment, so it never changes with the data (see viz/color.ts). */
export type EntertainmentType = "movie" | "tv" | "book" | "sports" | "game" | "other";

const TYPE_LABELS: Record<EntertainmentType, string> = {
  movie: "Movies",
  tv: "TV",
  book: "Books",
  sports: "Sports",
  game: "Games",
  other: "Other",
};

const TYPE_ORDER: EntertainmentType[] = ["movie", "tv", "book", "sports", "game", "other"];

/** Slot colour for a type; "other" gets none rather than a sixth hue. */
function typeColor(type: EntertainmentType): string | null {
  const index = TYPE_ORDER.indexOf(type);
  return index < 5 ? categoricalColor(index) : null;
}

export type TypeFilter = "all" | EntertainmentType;

export const TYPE_FILTERS: LeaderboardOption<TypeFilter>[] = [
  { id: "all", label: "All" },
  ...TYPE_ORDER.map((id) => ({ id, label: TYPE_LABELS[id] })),
];

export type EntertainmentSession = {
  date: string;
  minutes: number;
  type: EntertainmentType;
  /** Label for "other": the user-added kind's own name. */
  typeLabel: string;
  titleKey: string;
  title: string;
  titleDetail: string | null;
  location: string | null;
};

/**
 * Ranks entertainment by hours under one mode.
 *
 * - **type** — every session credited to its type. "Other" kinds each rank
 *   under their own name (Concert, Theatre) rather than one lump.
 * - **title** — one row per movie, TV show, book, game or generic title.
 *   Sports rank by **league**: an individual game is a one-off, and the
 *   league is the thing that's followed. `typeFilter` narrows to one type.
 * - **location** — where it happened, optionally within one type. A missing
 *   location ranks as "Unknown" alongside the logged "Unknown", since the
 *   two mean the same thing.
 */
export function buildEntertainmentLeaderboard(
  sessions: EntertainmentSession[],
  mode: EntertainmentMode,
  typeFilter: TypeFilter,
): LeaderboardRow[] {
  const credited: CreditedSession[] = sessions
    .filter((s) => mode === "type" || typeFilter === "all" || s.type === typeFilter)
    .map((s) => {
      const hours = s.minutes / 60;
      switch (mode) {
        case "type": {
          const key = s.type === "other" ? `other:${s.typeLabel}` : s.type;
          const name = s.type === "other" ? s.typeLabel : TYPE_LABELS[s.type];
          return { date: s.date, hours, credits: [{ key, name, color: typeColor(s.type) }] };
        }
        case "title":
          return {
            date: s.date,
            hours,
            credits: [
              {
                key: s.titleKey,
                name: s.title,
                detail: s.titleDetail,
                context: s.type === "other" ? s.typeLabel : TYPE_LABELS[s.type],
                color: typeColor(s.type),
              },
            ],
          };
        case "location": {
          const location = s.location?.trim() || "Unknown";
          return { date: s.date, hours, credits: [{ key: location, name: location }] };
        }
      }
    });
  return rankCreditedSessions(credited);
}

export function entertainmentColumns(mode: EntertainmentMode): LeaderboardColumns {
  const base = {
    valueHeader: "Time",
    valueFormat: "hours" as const,
    countHeader: "Sessions",
    countDescription: "Watches, reading sessions, games and plays logged — a TV episode is one session.",
    gainedNoun: "time gained",
  };
  switch (mode) {
    case "type":
      return { ...base, nameHeader: "Type" };
    case "title":
      return {
        ...base,
        nameHeader: "Title",
        contextHeader: "Type",
        contextDescription: "Sports rank by league, since a single game is a one-off.",
      };
    case "location":
      return { ...base, nameHeader: "Location" };
  }
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

export async function getEntertainmentSessions(): Promise<EntertainmentSession[]> {
  const db = getDb();
  const [movieRows, tvRows, bookRows, sportRows, gameRows, genericRows] = await Promise.all([
    db
      .select({
        date: movieWatches.date,
        minutes: movieWatches.durationMinutes,
        location: movieWatches.locationType,
        id: movies.id,
        title: movies.title,
        releaseDate: movies.releaseDate,
      })
      .from(movieWatches)
      .innerJoin(movies, eq(movieWatches.movieId, movies.id)),
    db
      .select({
        date: tvEpisodeWatches.date,
        minutes: tvEpisodeWatches.durationMinutes,
        location: tvEpisodeWatches.locationType,
        id: tvShows.id,
        title: tvShows.title,
      })
      .from(tvEpisodeWatches)
      .innerJoin(tvEpisodes, eq(tvEpisodeWatches.episodeId, tvEpisodes.id))
      .innerJoin(tvShows, eq(tvEpisodes.showId, tvShows.id)),
    db
      .select({
        date: bookReadingSessions.date,
        minutes: bookReadingSessions.durationMinutes,
        location: bookReadingSessions.locationType,
        id: books.id,
        title: books.title,
        authors: books.authors,
      })
      .from(bookReadingSessions)
      .innerJoin(books, eq(bookReadingSessions.bookId, books.id)),
    db
      .select({
        date: sportsWatches.date,
        minutes: sportsWatches.durationMinutes,
        location: sportsWatches.locationType,
        leagueId: sportsLeagues.id,
        league: sportsLeagues.name,
        sport: sports.name,
      })
      .from(sportsWatches)
      .innerJoin(sports, eq(sportsWatches.sportId, sports.id))
      .leftJoin(sportsLeagues, eq(sportsWatches.leagueId, sportsLeagues.id)),
    db
      .select({
        date: gameSessions.date,
        minutes: gameSessions.durationMinutes,
        location: gameSessions.locationType,
        id: games.id,
        title: games.name,
        gameType: games.type,
      })
      .from(gameSessions)
      .innerJoin(games, eq(gameSessions.gameId, games.id)),
    db
      .select({
        date: entertainmentEntries.date,
        minutes: entertainmentEntries.durationMinutes,
        location: entertainmentEntries.locationType,
        id: entertainmentCatalog.id,
        title: entertainmentCatalog.title,
        detail: entertainmentCatalog.detail,
        kind: entertainmentKinds.name,
        isSystem: entertainmentKinds.isSystem,
      })
      .from(entertainmentEntries)
      .innerJoin(entertainmentCatalog, eq(entertainmentEntries.entertainmentId, entertainmentCatalog.id))
      .innerJoin(entertainmentKinds, eq(entertainmentCatalog.kindId, entertainmentKinds.id)),
  ]);

  const sessions: EntertainmentSession[] = [];
  const push = (s: Omit<EntertainmentSession, "typeLabel"> & { typeLabel?: string }) =>
    sessions.push({ ...s, typeLabel: s.typeLabel ?? TYPE_LABELS[s.type] });

  for (const r of movieRows) {
    push({
      date: r.date,
      minutes: r.minutes ?? 0,
      type: "movie",
      titleKey: `movie:${r.id}`,
      title: r.title,
      titleDetail: r.releaseDate?.slice(0, 4) ?? null,
      location: r.location,
    });
  }
  for (const r of tvRows) {
    // A null date is a watch logged without a day (backfilled history);
    // it has no place on a dated leaderboard's movement windows.
    if (!r.date) continue;
    push({ date: r.date, minutes: r.minutes ?? 0, type: "tv", titleKey: `tv:${r.id}`, title: r.title, titleDetail: null, location: r.location });
  }
  for (const r of bookRows) {
    push({
      date: r.date,
      minutes: r.minutes ?? 0,
      type: "book",
      titleKey: `book:${r.id}`,
      title: r.title,
      titleDetail: r.authors.length > 0 ? r.authors.join(", ") : null,
      location: r.location,
    });
  }
  for (const r of sportRows) {
    push({
      date: r.date,
      minutes: r.minutes ?? 0,
      type: "sports",
      titleKey: r.leagueId !== null ? `league:${r.leagueId}` : `sport:${r.sport}`,
      title: r.league ?? r.sport,
      titleDetail: r.league ? r.sport : null,
      location: r.location,
    });
  }
  for (const r of gameRows) {
    push({ date: r.date, minutes: r.minutes ?? 0, type: "game", titleKey: `game:${r.id}`, title: r.title, titleDetail: r.gameType, location: r.location });
  }
  for (const r of genericRows) {
    const type = r.isSystem ? (SYSTEM_KIND_TYPES[r.kind.toLowerCase()] ?? "other") : "other";
    push({
      date: r.date,
      minutes: r.minutes ?? 0,
      type,
      typeLabel: type === "other" ? r.kind : undefined,
      titleKey: `entry:${r.id}`,
      title: r.title,
      titleDetail: r.detail,
      location: r.location,
    });
  }
  return sessions;
}

export async function getEntertainmentLeaderboardData(
  mode: EntertainmentMode,
  typeFilter: TypeFilter,
): Promise<LeaderboardRow[]> {
  return buildEntertainmentLeaderboard(await getEntertainmentSessions(), mode, typeFilter);
}
