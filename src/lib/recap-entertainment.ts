import { and, asc, count, desc, eq, gte, isNotNull, lt, lte, min, sum } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  artistGenres,
  artists,
  bookReadingSessions,
  bookRankings,
  books,
  gameSessions,
  genres,
  movieRankings,
  movieWatches,
  movies,
  musicListens,
  sportsWatches,
  tvEpisodeWatches,
} from "@/db/schema";
import { addDays, parseDate, toDateString } from "@/lib/date";
import { getDb } from "@/lib/db";
import type { RecapPeriod } from "@/lib/recap";

// The recap's entertainment section (issue #171, epic #130).
//
// This is the domain with the widest coverage variance in the app: the
// dedicated movie/TV/book/game/sports tables and the Spotify import all
// started at different points in its history, so an early year legitimately
// has zero of most of these. Every total here is fed through the
// foundation's coverage rule with the count itself as the coverage number,
// which makes an untracked medium read "Nothing logged this period" instead
// of a confident zero — and, just as importantly, suppresses a
// year-over-year delta measured against a year when the medium didn't exist
// yet.

// --- Music windows ---------------------------------------------------------

/**
 * `musicListens` is the one entertainment table not keyed on `days.date` —
 * the Spotify import gives each listen a `playedAt` timestamp instead — so
 * its period filter is a half-open timestamp range rather than a date
 * BETWEEN.
 *
 * The bounds are local midnight to local midnight, matching how the rest of
 * the app treats a calendar day (`src/lib/date.ts`: a day is whatever date
 * you say you're journaling for, in your own timezone). A listen right at a
 * year boundary can therefore land on the other side of it from the day
 * row it happened on, since the export's own timestamps are UTC. Over a
 * year-long window that's a few hours at each end and not worth
 * reconciling; it is worth knowing about before someone treats these counts
 * as exactly matching a per-day query.
 */
function inMusicWindow(period: RecapPeriod) {
  return and(
    gte(musicListens.playedAt, parseDate(period.start)),
    lt(musicListens.playedAt, parseDate(addDays(period.end, 1)))
  );
}

/**
 * Below this, a listen was a skip, not a play.
 *
 * 30 seconds is Spotify's own threshold for counting a play as a stream,
 * which makes it the least arbitrary line available and the one that
 * matches what the source data was built around. It's applied only to
 * *counts* ("tracks played"), where a skipped track would otherwise inflate
 * a headline number by a lot. Rankings by listening time deliberately skip
 * this filter: time already weights itself, since a three-second skip
 * contributes three seconds. Note this means the recap's track count is
 * intentionally stricter than the raw counts on the music pages
 * (`src/lib/music.ts`), which count every imported row.
 */
const MIN_LISTEN_MS = 30_000;

// --- Totals per medium -----------------------------------------------------

export type RecapMediumKey =
  | "movies"
  | "tvEpisodes"
  | "books"
  | "games"
  | "sports"
  | "tracks"
  | "podcasts";

export type RecapMediumTotal = {
  key: RecapMediumKey;
  label: string;
  /** Singular/plural unit shown under the number. */
  unit: string;
  count: number;
  priorCount: number;
};

const MEDIUM_LABELS: Record<RecapMediumKey, { label: string; unit: string }> = {
  movies: { label: "Movies watched", unit: "watches" },
  tvEpisodes: { label: "TV episodes", unit: "episodes" },
  books: { label: "Books finished", unit: "books" },
  games: { label: "Gaming sessions", unit: "sessions" },
  sports: { label: "Sports watched", unit: "games" },
  tracks: { label: "Tracks played", unit: "tracks" },
  podcasts: { label: "Podcast episodes", unit: "episodes" },
};

/**
 * One count per medium for a single period.
 *
 * Deliberate choices, each visible in the unit label so the card can't
 * overstate what it counted:
 * - Movies counts *watches*, not distinct films — a rewatch is a thing you
 *   did this year, and deduplicating would quietly disagree with the
 *   movie pages, which also log per watch.
 * - Books counts reading sessions flagged `completed`, i.e. books actually
 *   finished, not sessions spent reading. "Books read" meaning "times you
 *   opened a book" would be a much bigger and much less interesting
 *   number.
 * - Games counts sessions rather than distinct titles, since a game played
 *   all year and a game played once are not the same fact and session
 *   count is the one that reflects the year.
 */
async function countsFor(period: RecapPeriod): Promise<Record<RecapMediumKey, number>> {
  const db = getDb();
  const inPeriod = (column: AnyPgColumn) =>
    and(gte(column, period.start), lte(column, period.end));

  const [movieRows, tvRows, bookRows, gameRows, sportRows, trackRows, podcastRows] =
    await Promise.all([
      db.select({ n: count() }).from(movieWatches).where(inPeriod(movieWatches.date)),
      db.select({ n: count() }).from(tvEpisodeWatches).where(inPeriod(tvEpisodeWatches.date)),
      db
        .select({ n: count() })
        .from(bookReadingSessions)
        .where(and(inPeriod(bookReadingSessions.date), eq(bookReadingSessions.completed, true))),
      db.select({ n: count() }).from(gameSessions).where(inPeriod(gameSessions.date)),
      db.select({ n: count() }).from(sportsWatches).where(inPeriod(sportsWatches.date)),
      db
        .select({ n: count() })
        .from(musicListens)
        .where(
          and(
            inMusicWindow(period),
            isNotNull(musicListens.trackName),
            gte(musicListens.msPlayed, MIN_LISTEN_MS)
          )
        ),
      db
        .select({ n: count() })
        .from(musicListens)
        .where(
          and(
            inMusicWindow(period),
            isNotNull(musicListens.episodeName),
            gte(musicListens.msPlayed, MIN_LISTEN_MS)
          )
        ),
    ]);

  return {
    movies: movieRows[0]?.n ?? 0,
    tvEpisodes: tvRows[0]?.n ?? 0,
    books: bookRows[0]?.n ?? 0,
    games: gameRows[0]?.n ?? 0,
    sports: sportRows[0]?.n ?? 0,
    tracks: trackRows[0]?.n ?? 0,
    podcasts: podcastRows[0]?.n ?? 0,
  };
}

// --- Highlights ------------------------------------------------------------

/** A ranked item that was actually consumed in the period. */
export type RecapRankedPick = { title: string; rank: number };

/**
 * The highest-ranked movie among those watched in the period.
 *
 * `movieRankings` is a single all-time ordering (rank 1 is best — see
 * `saveMovieRankings` in days.ts, which writes `rank: i + 1` over an
 * ordered list), not a per-year list. So this is "the best film you
 * watched this year, by your own all-time ordering", which is a join
 * against the period's watches — not a slice of the ranking table, which
 * would just return your favourite film every year regardless of whether
 * you watched it.
 *
 * Returns null when nothing watched in the period has been ranked at all —
 * a real state, since ranking is a separate deliberate act from logging a
 * watch.
 */
async function topRankedMovie(period: RecapPeriod): Promise<RecapRankedPick | null> {
  const db = getDb();
  const [row] = await db
    .select({ title: movies.title, rank: movieRankings.rank })
    .from(movieRankings)
    .innerJoin(movies, eq(movies.id, movieRankings.movieId))
    .innerJoin(movieWatches, eq(movieWatches.movieId, movieRankings.movieId))
    .where(and(gte(movieWatches.date, period.start), lte(movieWatches.date, period.end)))
    .orderBy(asc(movieRankings.rank))
    .limit(1);
  return row ?? null;
}

/** Same shape as `topRankedMovie`, over books read in the period. */
async function topRankedBook(period: RecapPeriod): Promise<RecapRankedPick | null> {
  const db = getDb();
  const [row] = await db
    .select({ title: books.title, rank: bookRankings.rank })
    .from(bookRankings)
    .innerJoin(books, eq(books.id, bookRankings.bookId))
    .innerJoin(bookReadingSessions, eq(bookReadingSessions.bookId, bookRankings.bookId))
    .where(
      and(
        gte(bookReadingSessions.date, period.start),
        lte(bookReadingSessions.date, period.end)
      )
    )
    .orderBy(asc(bookRankings.rank))
    .limit(1);
  return row ?? null;
}

export type RecapListenPick = { name: string; minutes: number };

/**
 * Top artist by listening *time*, not play count.
 *
 * The two genuinely disagree: play count rewards short tracks and repeat
 * singles, time rewards the artist you actually spent the year with, which
 * is the question a recap is asking. Time also needs no skip filter, since
 * a skipped track contributes only its own few seconds. `src/lib/music.ts`
 * ranks the same way (`orderBy(desc(totalMs))`), so the recap and the
 * artist pages agree.
 */
async function topArtist(period: RecapPeriod): Promise<RecapListenPick | null> {
  const db = getDb();
  const totalMs = sum(musicListens.msPlayed).mapWith(Number);
  const [row] = await db
    .select({ name: artists.name, totalMs })
    .from(musicListens)
    .innerJoin(artists, eq(artists.id, musicListens.artistId))
    .where(inMusicWindow(period))
    .groupBy(artists.name)
    .orderBy(desc(totalMs))
    .limit(1);
  return row ? { name: row.name, minutes: Math.round((row.totalMs ?? 0) / 60_000) } : null;
}

/**
 * Most-listened genre tag, by the same listening-time metric as the artist
 * above.
 *
 * Genres come from Spotify's per-artist tags (`artistGenres`), so an artist
 * carrying five tags contributes its full listening time to all five. The
 * totals therefore overlap and deliberately do not sum to the year's
 * listening time — this is "your most-listened genre tag", not a partition
 * of your year. Splitting the time evenly across an artist's tags was
 * considered and rejected: it would invent precision the source data
 * doesn't have, and it would rank an artist tagged with one genre above an
 * equally-played artist tagged with four for no real reason.
 */
async function topGenre(period: RecapPeriod): Promise<RecapListenPick | null> {
  const db = getDb();
  const totalMs = sum(musicListens.msPlayed).mapWith(Number);
  const [row] = await db
    .select({ name: genres.name, totalMs })
    .from(musicListens)
    .innerJoin(artistGenres, eq(artistGenres.artistId, musicListens.artistId))
    .innerJoin(genres, eq(genres.id, artistGenres.genreId))
    .where(inMusicWindow(period))
    .groupBy(genres.name)
    .orderBy(desc(totalMs))
    .limit(1);
  return row ? { name: row.name, minutes: Math.round((row.totalMs ?? 0) / 60_000) } : null;
}

// --- Firsts ----------------------------------------------------------------

export type RecapFirsts = {
  /** Artists whose first-ever listen falls inside the period. */
  newArtists: { total: number; examples: string[] };
  /** Movie genres watched for the first time ever inside the period. */
  newMovieGenres: string[];
};

/**
 * "First of its kind" — things that appear in the period and have never
 * appeared before it.
 *
 * The rule is *earliest appearance anywhere in the usage tables*, not the
 * catalog row's `createdAt`. That distinction is load-bearing rather than
 * pedantic: rows migrated from the legacy app all share an import
 * timestamp, so a `createdAt`-based query would report a decade of
 * discoveries as having happened on migration day and would be flatly wrong
 * for every historical year — which #130 requires generating.
 *
 * This is the same query shape #172 needs for new people/places and #174
 * needs for its first-time moments. Whichever lands next should lift these
 * into one shared helper rather than write a third variant.
 */
async function firsts(period: RecapPeriod): Promise<RecapFirsts> {
  const db = getDb();

  const [artistRows, watchRows] = await Promise.all([
    // One row per artist, carrying the earliest listen across all time —
    // the aggregate does the work, so no listen history crosses the wire.
    db
      .select({ name: artists.name, firstListen: min(musicListens.playedAt).mapWith(musicListens.playedAt) })
      .from(musicListens)
      .innerJoin(artists, eq(artists.id, musicListens.artistId))
      .groupBy(artists.name),
    // Genres live in an array column on `movies`, so grouping by genre in
    // SQL would need `unnest` — a raw fragment, which this codebase's data
    // layer otherwise never uses. Fetching (date, genres) per watch and
    // folding it in TypeScript keeps the query in the builder and makes the
    // first-appearance rule itself testable, which matters more here than
    // the aggregation: these are personal-scale tables (a few thousand
    // watches across the app's whole history), not something worth raw SQL.
    db
      .select({ date: movieWatches.date, genres: movies.genres })
      .from(movieWatches)
      .innerJoin(movies, eq(movies.id, movieWatches.movieId)),
  ]);

  const newArtists = firstSeenInPeriod(
    period,
    artistRows.flatMap((row) =>
      row.firstListen ? [{ key: row.name, date: toDateString(row.firstListen) }] : []
    )
  );
  const newMovieGenres = firstSeenInPeriod(
    period,
    watchRows.flatMap((row) => row.genres.map((genre) => ({ key: genre, date: row.date })))
  );

  return {
    newArtists: { total: newArtists.length, examples: newArtists.slice(0, 3) },
    newMovieGenres,
  };
}

/**
 * Keys whose *earliest* appearance anywhere in the supplied history falls
 * inside the period, in discovery order.
 *
 * Callers pass every appearance they know about, across all time — not
 * just the period's — because the whole question is whether anything
 * earlier exists. Feeding this only the period's own rows would report
 * every key in it as new.
 *
 * Exported because #172 (new people and places) and #174 (first-time
 * moments) ask the identical question of different tables; this is the
 * shared helper those should use rather than each writing the rule again.
 */
export function firstSeenInPeriod(
  period: RecapPeriod,
  appearances: { key: string; date: string }[]
): string[] {
  const earliest = new Map<string, string>();
  for (const { key, date } of appearances) {
    const seen = earliest.get(key);
    if (seen === undefined || date < seen) earliest.set(key, date);
  }
  return [...earliest.entries()]
    .filter(([, date]) => date >= period.start && date <= period.end)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([key]) => key);
}

// --- The section -----------------------------------------------------------

export type RecapEntertainment = {
  totals: RecapMediumTotal[];
  topMovie: RecapRankedPick | null;
  topBook: RecapRankedPick | null;
  topArtist: RecapListenPick | null;
  topGenre: RecapListenPick | null;
  firsts: RecapFirsts;
};

export async function getRecapEntertainment(
  period: RecapPeriod,
  prior: RecapPeriod
): Promise<RecapEntertainment> {
  const [current, previous, movie, book, artist, genre, firstTimes] = await Promise.all([
    countsFor(period),
    countsFor(prior),
    topRankedMovie(period),
    topRankedBook(period),
    topArtist(period),
    topGenre(period),
    firsts(period),
  ]);

  const totals = (Object.keys(MEDIUM_LABELS) as RecapMediumKey[]).map((key) => ({
    key,
    ...MEDIUM_LABELS[key],
    count: current[key],
    priorCount: previous[key],
  }));

  return {
    totals,
    topMovie: movie,
    topBook: book,
    topArtist: artist,
    topGenre: genre,
    firsts: firstTimes,
  };
}
