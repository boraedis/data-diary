import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { geocodeAddress } from "@/lib/geocode";
import {
  bookReadingSessions,
  books,
  commuteEnum,
  days,
  dayTypeEnum,
  entertainmentCatalog,
  entertainmentEntries,
  entertainmentKindEnum,
  exerciseCategoryEnum,
  exercises,
  movies,
  movieWatches,
  people,
  places,
  sports,
  sportsLeagues,
  sportsTeams,
  sportsWatches,
  tags,
  tvEpisodes,
  tvEpisodeWatches,
  tvShows,
  workLocationEnum,
  workoutDataSourceEnum,
  workouts,
  workoutSets,
  type CommuteOption,
  type DayType,
  type EntertainmentKind,
  type ExerciseCategory,
  type PersonValence,
  type WorkLocationOption,
  type WorkoutDataSource,
} from "@/db/schema";

// Self-join aliases — a sports watch references `sportsTeams` twice (home
// and away), so the two sides need distinct table aliases the same way a
// raw SQL query would need two table aliases for one self-join.
const homeSportsTeams = alias(sportsTeams, "home_sports_teams");
const awaySportsTeams = alias(sportsTeams, "away_sports_teams");

// Fixed slot counts, carried over from the legacy app's `searchs/people` /
// `searchs/places` catalogs: always 7 positive + 3 negative person slots,
// always 2 place slots, whether or not every slot is filled on a given day.
// These are stored as fixed columns on `days` (positivePerson1Id..7Id,
// negativePerson1Id..3Id, place1Id/place2Id) rather than a satellite table —
// see the schema.ts comment above those columns for why.
export const POSITIVE_PEOPLE_SLOTS = 7;
export const NEGATIVE_PEOPLE_SLOTS = 3;
export const PLACE_SLOTS = 2;

// The legacy app's tracked subscription list was itself a configurable
// Firestore doc (`entry_structure/Subs`), not hardcoded — that doc wasn't
// reachable during this migration, so this is the real list, straight from
// the user: exactly these nine abbreviations, nothing else. Stored as nine
// fixed columns on `days` (subA..subK, see schema.ts) rather than a
// normalized table, same reasoning as people/places above.
export const SUB_NAMES = ["A", "W", "C", "L", "Ni", "NO", "Ad", "D", "K"] as const;

// Maps each fixed slot to the `days` column that holds it, in slot order —
// used by both loadDay (reading the columns back out) and savePeople/
// savePlaces/saveSubs (building the partial-upsert `set`).
const POSITIVE_PERSON_COLUMNS = [
  "positivePerson1Id",
  "positivePerson2Id",
  "positivePerson3Id",
  "positivePerson4Id",
  "positivePerson5Id",
  "positivePerson6Id",
  "positivePerson7Id",
] as const;
const NEGATIVE_PERSON_COLUMNS = [
  "negativePerson1Id",
  "negativePerson2Id",
  "negativePerson3Id",
] as const;
const PLACE_ID_COLUMNS = ["place1Id", "place2Id"] as const;
const SUB_COLUMNS = ["subA", "subW", "subC", "subL", "subNi", "subNO", "subAd", "subD", "subK"] as const;

export type WorkoutSetPayload = {
  setNumber: number;
  reps: number | null;
  weightLbs: number | null;
  durationSeconds: number | null;
};

// What a workout save actually needs. `sets` only makes sense for
// strength-category exercises; durationMinutes/distanceKm/effort only make
// sense for distance/sport-category ones — see exerciseCategoryEnum in the
// schema for which fields a given exercise's category expects. Nothing here
// enforces that pairing (the form does, by only showing the relevant
// fields); saving is happy to store nulls for whichever fields don't apply.
export type WorkoutPayload = {
  exerciseId: number;
  locationId: number | null;
  subtype: string | null;
  dataSource: WorkoutDataSource;
  durationMinutes: number | null;
  distanceKm: number | null;
  effort: number | null;
  sets: WorkoutSetPayload[];
};

// The read-side shape of a workout: same fields as WorkoutPayload, plus the
// exercise's name/category and the location's name resolved via join, so
// the entry form and summary page don't need a second catalog round-trip
// just to label what's already saved.
export type WorkoutEntry = WorkoutPayload & {
  exerciseName: string;
  exerciseCategory: ExerciseCategory;
  locationName: string | null;
};

/** The full day record — every section's fields together. This is what
 * `loadDay` returns; it's used to render the day summary page (which needs
 * to see all sections at once to compute completion) and as the response
 * shape each section's save endpoint returns after saving. Individual
 * entry forms only read and submit their own section's slice (see the
 * Health/Sleep/Happiness/WorkPayload types below) — each section saves
 * independently, mirroring the legacy app's one-page-per-category forms. */
export type DayPayload = {
  date: string;
  distanceWalkedKm: number | null;
  coffees: number | null;
  sick: boolean | null;
  sleepTime: string | null;
  wakeTime: string | null;
  wakeCrossedMidnight: boolean;
  sleepLocationType: string | null;
  sleepLocationSubtype: string | null;
  napMinutes: number | null;
  happiness: number | null;
  happinessReason: string | null;
  journal: string | null;
  dayType: DayType | null;
  productivity: number | null;
  workDurationMinutes: number | null;
  workLocation: WorkLocationOption[];
  commute: CommuteOption[];
  workouts: WorkoutEntry[];
  phoneUsageMinutes: number | null;
  laptopUsageMinutes: number | null;
  instagramUsageMinutes: number | null;
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
  instagramFollowers: number | null;
  instagramFollowing: number | null;
  subs: SubEntry[];
  people: PersonEntry[];
  places: PlaceEntry[];
  entertainment: EntertainmentEntry[];
  movies: MovieWatchEntry[];
  sportsWatches: SportsWatchEntry[];
  bookSessions: BookReadingSessionEntry[];
};

export type HealthPayload = {
  distanceWalkedKm: number | null;
  coffees: number | null;
  sick: boolean | null;
  workouts: WorkoutPayload[];
};

export type SleepPayload = {
  sleepTime: string | null;
  wakeTime: string | null;
  wakeCrossedMidnight: boolean;
  sleepLocationType: string | null;
  sleepLocationSubtype: string | null;
  napMinutes: number | null;
};

export type HappinessPayload = {
  happiness: number | null;
  happinessReason: string | null;
  journal: string | null;
  dayType: DayType | null;
};

export type WorkPayload = {
  productivity: number | null;
  workDurationMinutes: number | null;
  workLocation: WorkLocationOption[];
  commute: CommuteOption[];
};

export type TechnologyPayload = {
  phoneUsageMinutes: number | null;
  laptopUsageMinutes: number | null;
  instagramUsageMinutes: number | null;
};

export type WeightPayload = {
  weightKg: number | null;
  bodyFatPercent: number | null;
  muscleMassKg: number | null;
};

export type SocialMediaPayload = {
  instagramFollowers: number | null;
  instagramFollowing: number | null;
};

export type SubEntry = { name: string; value: number };
export type SubsPayload = { entries: SubEntry[] };

// personId/placeId point at the people/places catalogs; slot is the fixed
// position within its valence (people) or within the day (places) — see
// the POSITIVE_PEOPLE_SLOTS/NEGATIVE_PEOPLE_SLOTS/PLACE_SLOTS constants
// above. `name` is resolved via join for display and isn't part of what
// gets saved (see PeoplePayload/PlacesPayload below).
export type PersonEntry = { slot: number; valence: PersonValence; personId: number; name: string };
export type PeoplePayload = { entries: { slot: number; valence: PersonValence; personId: number }[] };

export type PlaceEntry = { slot: number; placeId: number; name: string };
export type PlacesPayload = { entries: { slot: number; placeId: number }[] };

export type EntertainmentEntry = {
  entertainmentId: number;
  kind: EntertainmentKind;
  title: string;
  durationMinutes: number | null;
  notes: string | null;
};
export type EntertainmentPayload = {
  entries: { entertainmentId: number; durationMinutes: number | null; notes: string | null }[];
};

// Movies are open-ended like entertainment (any number of watches per day,
// including the same movie twice — a matinee and a rewatch that evening),
// so, like entertainment, saving is a replace-on-save against a satellite
// table rather than a fixed set of `days` columns — see saveMovies below.
// `title`/`releaseDate`/`posterPath`/`runtimeMinutes` on the read side are
// resolved via join purely for display and aren't part of what gets saved.
export type MovieWatchEntry = {
  id: number;
  movieId: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  runtimeMinutes: number | null;
  rating: number | null;
  locationType: string | null;
};
export type MovieWatchPayload = { movieId: number; rating: number | null; locationType: string | null };
export type MoviesPayload = { entries: MovieWatchPayload[] };

// Same open-ended replace-on-save shape as movies — any number of watches
// per day, including the same game twice (a live watch, then a replay).
// `sportName`/`leagueName`/`homeTeamName`/`awayTeamName` on the read side
// are resolved via join purely for display and aren't part of what gets
// saved. Unlike movies (a single external-lookup catalog id per watch),
// sports watches reference the manual sport/league/team hierarchy directly
// — there's no separate "pick a catalog item, then log details" split.
export type SportsWatchEntry = {
  id: number;
  sportId: number;
  sportName: string;
  leagueId: number | null;
  leagueName: string | null;
  season: string | null;
  gameType: string | null;
  homeTeamId: number | null;
  homeTeamName: string | null;
  awayTeamId: number | null;
  awayTeamName: string | null;
  watchedLive: boolean;
  durationMinutes: number | null;
  locationType: string | null;
};
export type SportsWatchPayload = {
  sportId: number;
  leagueId: number | null;
  season: string | null;
  gameType: string | null;
  homeTeamId: number | null;
  awayTeamId: number | null;
  watchedLive: boolean;
  durationMinutes: number | null;
  locationType: string | null;
};
export type SportsPayload = { entries: SportsWatchPayload[] };

// Same open-ended replace-on-save shape as movies/sports — any number of
// reading sessions per day, including the same book twice (a morning
// session and an evening session). `title`/`authors`/`thumbnailUrl`/
// `pageCount` on the read side are resolved via join purely for display.
// Unlike a movie watch, a session has no rating — instead it tracks
// `startPage`/`endPage` (so "current page" can be computed on read, per the
// schema.ts comment above `books`) and `completed` (so "completions" can
// be computed the same way).
export type BookReadingSessionEntry = {
  id: number;
  bookId: number;
  title: string;
  authors: string[];
  thumbnailUrl: string | null;
  pageCount: number | null;
  startPage: number | null;
  endPage: number | null;
  completed: boolean;
  locationType: string | null;
  durationMinutes: number | null;
};
export type BookReadingSessionPayload = {
  bookId: number;
  startPage: number | null;
  endPage: number | null;
  completed: boolean;
  locationType: string | null;
  durationMinutes: number | null;
};
export type BooksPayload = { entries: BookReadingSessionPayload[] };

// Catalog item shapes carry every field the legacy "New Person"/"New Place"/
// "New entertainment" modals captured (see the schema comments above people/
// places/entertainmentCatalog for exactly what was and wasn't carried over)
// — the entry forms need these for both the "+ New" creation modals and for
// building disambiguating secondary/search text in the search panel (see
// components/entry-forms/search-panel.tsx).
export type PersonCatalogItem = {
  id: number;
  name: string;
  nicknames: string[];
  birthdate: string | null;
  gender: string | null;
  tagId: number | null;
  // Resolved via a left join against `tags` on every read — null whenever
  // tagId is null, never independently out of sync with it the way
  // legacy's denormalized `searchs/people` tag-name copy could be.
  tagName: string | null;
  tagColor: string | null;
};
export type PlaceCatalogItem = {
  id: number;
  name: string;
  alias: string | null;
  address: string | null;
  category: string | null;
  subcategory: string | null;
  parentId: number | null;
  subregionName: string | null;
  color: string | null;
  // "<id>/.../<id>/" and "<name>/.../<name>/" from root to self inclusive —
  // see the `places` table comment in schema.ts. Null until backfilled or
  // first saved through createPlaceCatalogEntry/updatePlaceCatalogEntry.
  idPath: string | null;
  namePath: string | null;
  metroId: number | null;
  lat: number | null;
  lng: number | null;
};
export type ExerciseCatalogItem = { id: number; name: string; category: ExerciseCategory };
export type EntertainmentCatalogItem = {
  id: number;
  kind: EntertainmentKind;
  title: string;
  detail: string | null;
};
// The movies catalog is populated from TMDB (see src/lib/tmdb.ts and
// src/app/api/movies/route.ts), not typed in by hand like the catalogs
// above — every field here is real TMDB metadata, fetched once per movie
// and cached in the `movies` table so repeat watches don't refetch it.
export type MovieCatalogItem = {
  id: number;
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  posterPath: string | null;
  genres: string[];
  collectionName: string | null;
};

// The sports catalog, unlike movies/tvShows, has no external API — it's a
// fully manual sport -> league -> team hierarchy, same "+ New" pattern as
// people/places/exercises. `leagueId` on a team is nullable (an
// individual-athlete sport's "team" may just be a person with no league at
// all), and a league's `type` is a free-text label (e.g. "college" vs
// "pro"), not an enum.
export type SportCatalogItem = { id: number; name: string; isTeamSport: boolean };
export type SportsLeagueItem = { id: number; sportId: number; name: string; type: string | null };
export type SportsTeamItem = {
  id: number;
  sportId: number;
  leagueId: number | null;
  name: string;
  alias: string | null;
  homeLocation: string | null;
  color: string | null;
  division: string | null;
};

// The books catalog is populated from Google Books (see
// src/lib/google-books.ts and src/app/api/books/route.ts), same
// upsert-once-cache-forever pattern as movies/tvShows. Reading progress
// (`currentPage`/`completions`) is deliberately NOT part of this shape —
// see the schema.ts comment above `books` — it's computed on read, per
// book, by getBookProgress below.
export type BookCatalogItem = {
  id: number;
  googleBooksId: string;
  title: string;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  pageCount: number | null;
  categories: string[];
};

/** Reads one day's full record — the scalar day row plus its workouts and
 * their sets — straight from the database. Used by the summary page, by
 * each section's own entry page (each just reads the slice it needs), and
 * returned by every save function below (so a save always hands back an
 * up-to-date full day). No self-fetch over HTTP anywhere. */
export async function loadDay(date: string): Promise<DayPayload> {
  const db = getDb();

  const [dayRow] = await db.select().from(days).where(eq(days.date, date));
  const workoutRows = await db
    .select({
      id: workouts.id,
      exerciseId: workouts.exerciseId,
      exerciseName: exercises.name,
      exerciseCategory: exercises.category,
      locationId: workouts.locationId,
      locationName: places.name,
      subtype: workouts.subtype,
      dataSource: workouts.dataSource,
      durationMinutes: workouts.durationMinutes,
      distanceKm: workouts.distanceKm,
      effort: workouts.effort,
    })
    .from(workouts)
    .innerJoin(exercises, eq(workouts.exerciseId, exercises.id))
    .leftJoin(places, eq(workouts.locationId, places.id))
    .where(eq(workouts.date, date))
    .orderBy(asc(workouts.sortOrder), asc(workouts.id));

  const workoutIds = workoutRows.map((w) => w.id);
  const setRows = workoutIds.length
    ? await db
        .select()
        .from(workoutSets)
        .where(inArray(workoutSets.workoutId, workoutIds))
        .orderBy(asc(workoutSets.setNumber))
    : [];

  const setsByWorkout = new Map<number, typeof setRows>();
  for (const set of setRows) {
    const list = setsByWorkout.get(set.workoutId) ?? [];
    list.push(set);
    setsByWorkout.set(set.workoutId, list);
  }

  // Fixed-slot people/places/subs all live as columns straight on `dayRow`
  // now (see schema.ts) — no satellite table to query. What's left to fetch
  // is just the *names* for whichever person/place ids are actually filled
  // in, via one batched lookup each rather than N individual ones.
  const positiveIds = POSITIVE_PERSON_COLUMNS.map((key) => dayRow?.[key] ?? null);
  const negativeIds = NEGATIVE_PERSON_COLUMNS.map((key) => dayRow?.[key] ?? null);
  const placeIds = PLACE_ID_COLUMNS.map((key) => dayRow?.[key] ?? null);
  const allPersonIds = [...positiveIds, ...negativeIds].filter((id): id is number => id !== null);
  const allPlaceIds = placeIds.filter((id): id is number => id !== null);

  const [peopleNameRows, placeNameRows, entertainmentRows, movieWatchRows, sportsWatchRows, bookSessionRows] =
    await Promise.all([
    allPersonIds.length
      ? db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, allPersonIds))
      : Promise.resolve([]),
    allPlaceIds.length
      ? db.select({ id: places.id, name: places.name }).from(places).where(inArray(places.id, allPlaceIds))
      : Promise.resolve([]),
    db
      .select({
        entertainmentId: entertainmentEntries.entertainmentId,
        durationMinutes: entertainmentEntries.durationMinutes,
        notes: entertainmentEntries.notes,
        sortOrder: entertainmentEntries.sortOrder,
        kind: entertainmentCatalog.kind,
        title: entertainmentCatalog.title,
      })
      .from(entertainmentEntries)
      .innerJoin(entertainmentCatalog, eq(entertainmentEntries.entertainmentId, entertainmentCatalog.id))
      .where(eq(entertainmentEntries.date, date))
      .orderBy(asc(entertainmentEntries.sortOrder)),
    db
      .select({
        id: movieWatches.id,
        movieId: movieWatches.movieId,
        title: movies.title,
        releaseDate: movies.releaseDate,
        posterPath: movies.posterPath,
        runtimeMinutes: movies.runtimeMinutes,
        rating: movieWatches.rating,
        locationType: movieWatches.locationType,
      })
      .from(movieWatches)
      .innerJoin(movies, eq(movieWatches.movieId, movies.id))
      .where(eq(movieWatches.date, date))
      .orderBy(asc(movieWatches.id)),
    db
      .select({
        id: sportsWatches.id,
        sportId: sportsWatches.sportId,
        sportName: sports.name,
        leagueId: sportsWatches.leagueId,
        leagueName: sportsLeagues.name,
        season: sportsWatches.season,
        gameType: sportsWatches.gameType,
        homeTeamId: sportsWatches.homeTeamId,
        homeTeamName: homeSportsTeams.name,
        awayTeamId: sportsWatches.awayTeamId,
        awayTeamName: awaySportsTeams.name,
        watchedLive: sportsWatches.watchedLive,
        durationMinutes: sportsWatches.durationMinutes,
        locationType: sportsWatches.locationType,
      })
      .from(sportsWatches)
      .innerJoin(sports, eq(sportsWatches.sportId, sports.id))
      .leftJoin(sportsLeagues, eq(sportsWatches.leagueId, sportsLeagues.id))
      .leftJoin(homeSportsTeams, eq(sportsWatches.homeTeamId, homeSportsTeams.id))
      .leftJoin(awaySportsTeams, eq(sportsWatches.awayTeamId, awaySportsTeams.id))
      .where(eq(sportsWatches.date, date))
      .orderBy(asc(sportsWatches.id)),
    db
      .select({
        id: bookReadingSessions.id,
        bookId: bookReadingSessions.bookId,
        title: books.title,
        authors: books.authors,
        thumbnailUrl: books.thumbnailUrl,
        pageCount: books.pageCount,
        startPage: bookReadingSessions.startPage,
        endPage: bookReadingSessions.endPage,
        completed: bookReadingSessions.completed,
        locationType: bookReadingSessions.locationType,
        durationMinutes: bookReadingSessions.durationMinutes,
      })
      .from(bookReadingSessions)
      .innerJoin(books, eq(bookReadingSessions.bookId, books.id))
      .where(eq(bookReadingSessions.date, date))
      .orderBy(asc(bookReadingSessions.id)),
  ]);

  const personNameById = new Map(peopleNameRows.map((p) => [p.id, p.name]));
  const placeNameById = new Map(placeNameRows.map((p) => [p.id, p.name]));

  const personEntries: PersonEntry[] = [];
  positiveIds.forEach((personId, slot) => {
    if (personId === null) return;
    const name = personNameById.get(personId);
    if (name === undefined) return; // shouldn't happen given the FK, but don't blow up the whole page over it
    personEntries.push({ slot, valence: "positive", personId, name });
  });
  negativeIds.forEach((personId, slot) => {
    if (personId === null) return;
    const name = personNameById.get(personId);
    if (name === undefined) return;
    personEntries.push({ slot, valence: "negative", personId, name });
  });

  const placeEntries: PlaceEntry[] = [];
  placeIds.forEach((placeId, slot) => {
    if (placeId === null) return;
    const name = placeNameById.get(placeId);
    if (name === undefined) return;
    placeEntries.push({ slot, placeId, name });
  });

  const subEntryList: SubEntry[] = [];
  SUB_COLUMNS.forEach((key, i) => {
    const value = dayRow?.[key] ?? null;
    if (value !== null) subEntryList.push({ name: SUB_NAMES[i], value });
  });

  return {
    date,
    distanceWalkedKm: dayRow?.distanceWalkedKm ?? null,
    coffees: dayRow?.coffees ?? null,
    sick: dayRow?.sick ?? null,
    sleepTime: dayRow?.sleepTime ?? null,
    wakeTime: dayRow?.wakeTime ?? null,
    wakeCrossedMidnight: dayRow?.wakeCrossedMidnight ?? false,
    sleepLocationType: dayRow?.sleepLocationType ?? null,
    sleepLocationSubtype: dayRow?.sleepLocationSubtype ?? null,
    napMinutes: dayRow?.napMinutes ?? null,
    happiness: dayRow?.happiness ?? null,
    happinessReason: dayRow?.happinessReason ?? null,
    journal: dayRow?.journal ?? null,
    dayType: dayRow?.dayType ?? null,
    productivity: dayRow?.productivity ?? null,
    workDurationMinutes: dayRow?.workDurationMinutes ?? null,
    workLocation: dayRow?.workLocation ?? [],
    commute: dayRow?.commute ?? [],
    workouts: workoutRows.map((w) => ({
      exerciseId: w.exerciseId,
      exerciseName: w.exerciseName,
      exerciseCategory: w.exerciseCategory,
      locationId: w.locationId,
      locationName: w.locationName,
      subtype: w.subtype,
      dataSource: w.dataSource,
      durationMinutes: w.durationMinutes,
      distanceKm: w.distanceKm,
      effort: w.effort,
      sets: (setsByWorkout.get(w.id) ?? []).map((s) => ({
        setNumber: s.setNumber,
        reps: s.reps,
        weightLbs: s.weightLbs,
        durationSeconds: s.durationSeconds,
      })),
    })),
    phoneUsageMinutes: dayRow?.phoneUsageMinutes ?? null,
    laptopUsageMinutes: dayRow?.laptopUsageMinutes ?? null,
    instagramUsageMinutes: dayRow?.instagramUsageMinutes ?? null,
    weightKg: dayRow?.weightKg ?? null,
    bodyFatPercent: dayRow?.bodyFatPercent ?? null,
    muscleMassKg: dayRow?.muscleMassKg ?? null,
    instagramFollowers: dayRow?.instagramFollowers ?? null,
    instagramFollowing: dayRow?.instagramFollowing ?? null,
    subs: subEntryList,
    people: personEntries,
    places: placeEntries,
    entertainment: entertainmentRows.map((e) => ({
      entertainmentId: e.entertainmentId,
      kind: e.kind,
      title: e.title,
      durationMinutes: e.durationMinutes,
      notes: e.notes,
    })),
    movies: movieWatchRows.map((w) => ({
      id: w.id,
      movieId: w.movieId,
      title: w.title,
      releaseDate: w.releaseDate,
      posterPath: w.posterPath,
      runtimeMinutes: w.runtimeMinutes,
      rating: w.rating,
      locationType: w.locationType,
    })),
    sportsWatches: sportsWatchRows.map((w) => ({
      id: w.id,
      sportId: w.sportId,
      sportName: w.sportName,
      leagueId: w.leagueId,
      leagueName: w.leagueName,
      season: w.season,
      gameType: w.gameType,
      homeTeamId: w.homeTeamId,
      homeTeamName: w.homeTeamName,
      awayTeamId: w.awayTeamId,
      awayTeamName: w.awayTeamName,
      watchedLive: w.watchedLive,
      durationMinutes: w.durationMinutes,
      locationType: w.locationType,
    })),
    bookSessions: bookSessionRows.map((s) => ({
      id: s.id,
      bookId: s.bookId,
      title: s.title,
      authors: s.authors,
      thumbnailUrl: s.thumbnailUrl,
      pageCount: s.pageCount,
      startPage: s.startPage,
      endPage: s.endPage,
      completed: s.completed,
      locationType: s.locationType,
      durationMinutes: s.durationMinutes,
    })),
  };
}

const DAY_TYPES = new Set<string>(dayTypeEnum.enumValues);
const WORK_LOCATIONS = new Set<string>(workLocationEnum.enumValues);
const COMMUTES = new Set<string>(commuteEnum.enumValues);
const DATA_SOURCES = new Set<string>(workoutDataSourceEnum.enumValues);
const PERSON_VALENCES = new Set<string>(["positive", "negative"] satisfies PersonValence[]);
const ENTERTAINMENT_KINDS = new Set<string>(entertainmentKindEnum.enumValues);
const EXERCISE_CATEGORIES = new Set<string>(exerciseCategoryEnum.enumValues);

function isPercent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWorkouts(input: unknown): Result<WorkoutPayload[]> {
  const workoutsInput = Array.isArray(input) ? (input as Record<string, unknown>[]) : [];
  const parsed: WorkoutPayload[] = [];
  for (const w of workoutsInput) {
    const exerciseId = typeof w.exerciseId === "number" ? w.exerciseId : NaN;
    if (!Number.isInteger(exerciseId)) {
      return { ok: false, error: "Every workout needs an exercise" };
    }

    const dataSource = DATA_SOURCES.has(w.dataSource as string)
      ? (w.dataSource as WorkoutDataSource)
      : "manual";

    const setsInput = Array.isArray(w.sets) ? (w.sets as Record<string, unknown>[]) : [];
    parsed.push({
      exerciseId,
      locationId: typeof w.locationId === "number" ? w.locationId : null,
      subtype: typeof w.subtype === "string" && w.subtype.trim() ? w.subtype.trim() : null,
      dataSource,
      durationMinutes: typeof w.durationMinutes === "number" ? w.durationMinutes : null,
      distanceKm: typeof w.distanceKm === "number" ? w.distanceKm : null,
      effort: typeof w.effort === "number" ? w.effort : null,
      sets: setsInput.map((s, i) => ({
        setNumber: typeof s.setNumber === "number" ? s.setNumber : i + 1,
        reps: typeof s.reps === "number" ? s.reps : null,
        weightLbs: typeof s.weightLbs === "number" ? s.weightLbs : null,
        durationSeconds: typeof s.durationSeconds === "number" ? s.durationSeconds : null,
      })),
    });
  }
  return { ok: true, value: parsed };
}

export function validateHealthPayload(body: unknown): Result<HealthPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const workoutsResult = parseWorkouts(b.workouts);
  if (!workoutsResult.ok) return workoutsResult;

  return {
    ok: true,
    value: {
      distanceWalkedKm: typeof b.distanceWalkedKm === "number" ? b.distanceWalkedKm : null,
      coffees: typeof b.coffees === "number" ? b.coffees : null,
      sick: typeof b.sick === "boolean" ? b.sick : null,
      workouts: workoutsResult.value,
    },
  };
}

export function validateSleepPayload(body: unknown): Result<SleepPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  return {
    ok: true,
    value: {
      sleepTime: typeof b.sleepTime === "string" && b.sleepTime ? b.sleepTime : null,
      wakeTime: typeof b.wakeTime === "string" && b.wakeTime ? b.wakeTime : null,
      wakeCrossedMidnight: Boolean(b.wakeCrossedMidnight),
      sleepLocationType:
        typeof b.sleepLocationType === "string" && b.sleepLocationType ? b.sleepLocationType : null,
      sleepLocationSubtype:
        typeof b.sleepLocationSubtype === "string" && b.sleepLocationSubtype
          ? b.sleepLocationSubtype
          : null,
      napMinutes: typeof b.napMinutes === "number" ? b.napMinutes : null,
    },
  };
}

export function validateHappinessPayload(body: unknown): Result<HappinessPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  if (b.happiness !== null && b.happiness !== undefined && !isPercent(b.happiness)) {
    return { ok: false, error: "Happiness must be between 0 and 100" };
  }
  if (b.dayType && !DAY_TYPES.has(b.dayType as string)) {
    return { ok: false, error: "Invalid day type" };
  }

  return {
    ok: true,
    value: {
      happiness: typeof b.happiness === "number" ? b.happiness : null,
      happinessReason:
        typeof b.happinessReason === "string" && b.happinessReason ? b.happinessReason : null,
      journal: typeof b.journal === "string" && b.journal ? b.journal : null,
      dayType: (b.dayType as DayType) || null,
    },
  };
}

export function validateWorkPayload(body: unknown): Result<WorkPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  if (b.productivity !== null && b.productivity !== undefined && !isPercent(b.productivity)) {
    return { ok: false, error: "Productivity must be between 0 and 100" };
  }

  const workLocation = Array.isArray(b.workLocation) ? (b.workLocation as string[]) : [];
  for (const loc of workLocation) {
    if (!WORK_LOCATIONS.has(loc)) {
      return { ok: false, error: `Invalid work location: ${loc}` };
    }
  }

  const commute = Array.isArray(b.commute) ? (b.commute as string[]) : [];
  for (const c of commute) {
    if (!COMMUTES.has(c)) {
      return { ok: false, error: `Invalid commute option: ${c}` };
    }
  }

  // Mirrors the legacy form's *intended* behavior (its error message said
  // commute was required whenever work happened anywhere other than home,
  // but its actual check only looked for the literal value "office" — a
  // real code/message mismatch). This enforces what the message promised.
  const awayFromHome = workLocation.some((loc) => loc !== "home");
  if (awayFromHome && commute.length === 0) {
    return {
      ok: false,
      error: "Commute is required when work location is away from home",
    };
  }

  return {
    ok: true,
    value: {
      productivity: typeof b.productivity === "number" ? b.productivity : null,
      workDurationMinutes: typeof b.workDurationMinutes === "number" ? b.workDurationMinutes : null,
      workLocation: workLocation as WorkLocationOption[],
      commute: commute as CommuteOption[],
    },
  };
}

export function validateTechnologyPayload(body: unknown): Result<TechnologyPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  return {
    ok: true,
    value: {
      phoneUsageMinutes: typeof b.phoneUsageMinutes === "number" ? b.phoneUsageMinutes : null,
      laptopUsageMinutes: typeof b.laptopUsageMinutes === "number" ? b.laptopUsageMinutes : null,
      instagramUsageMinutes:
        typeof b.instagramUsageMinutes === "number" ? b.instagramUsageMinutes : null,
    },
  };
}

export function validateWeightPayload(body: unknown): Result<WeightPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  return {
    ok: true,
    value: {
      weightKg: typeof b.weightKg === "number" ? b.weightKg : null,
      bodyFatPercent: typeof b.bodyFatPercent === "number" ? b.bodyFatPercent : null,
      muscleMassKg: typeof b.muscleMassKg === "number" ? b.muscleMassKg : null,
    },
  };
}

export function validateSocialMediaPayload(body: unknown): Result<SocialMediaPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  return {
    ok: true,
    value: {
      instagramFollowers: typeof b.instagramFollowers === "number" ? b.instagramFollowers : null,
      instagramFollowing: typeof b.instagramFollowing === "number" ? b.instagramFollowing : null,
    },
  };
}

const SUB_NAME_SET = new Set<string>(SUB_NAMES);

export function validateSubsPayload(body: unknown): Result<SubsPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const seenNames = new Set<string>();
  const entries: SubEntry[] = [];
  for (const e of input) {
    const name = typeof e.name === "string" ? e.name.trim() : "";
    if (!SUB_NAME_SET.has(name)) {
      return { ok: false, error: `Unknown sub "${name}" — must be one of ${SUB_NAMES.join(", ")}` };
    }
    if (seenNames.has(name)) {
      return { ok: false, error: `Duplicate sub "${name}"` };
    }
    seenNames.add(name);
    const value = typeof e.value === "number" ? e.value : NaN;
    // Legacy range was 0-10 (an in-app usage/satisfaction rating, not a
    // dollar amount, despite the category being subscriptions).
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      return { ok: false, error: `${name}: value must be a whole number between 0 and 10` };
    }
    entries.push({ name, value });
  }

  return { ok: true, value: { entries } };
}

export function validatePeoplePayload(body: unknown): Result<PeoplePayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const seenSlots = new Set<string>();
  const entries: PeoplePayload["entries"] = [];
  for (const e of input) {
    const valence = e.valence as string;
    if (!PERSON_VALENCES.has(valence)) {
      return { ok: false, error: "Invalid valence" };
    }
    const maxSlot = valence === "positive" ? POSITIVE_PEOPLE_SLOTS - 1 : NEGATIVE_PEOPLE_SLOTS - 1;
    const slot = typeof e.slot === "number" ? e.slot : NaN;
    if (!Number.isInteger(slot) || slot < 0 || slot > maxSlot) {
      return { ok: false, error: `Invalid slot for ${valence} person` };
    }
    const slotKey = `${valence}:${slot}`;
    if (seenSlots.has(slotKey)) {
      return { ok: false, error: "Duplicate person slot" };
    }
    seenSlots.add(slotKey);

    const personId = typeof e.personId === "number" ? e.personId : NaN;
    if (!Number.isInteger(personId)) {
      return { ok: false, error: "Invalid person" };
    }
    entries.push({ slot, valence: valence as PersonValence, personId });
  }

  return { ok: true, value: { entries } };
}

export function validatePlacesPayload(body: unknown): Result<PlacesPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const seenSlots = new Set<number>();
  const entries: PlacesPayload["entries"] = [];
  for (const e of input) {
    const slot = typeof e.slot === "number" ? e.slot : NaN;
    if (!Number.isInteger(slot) || slot < 0 || slot > PLACE_SLOTS - 1) {
      return { ok: false, error: "Invalid place slot" };
    }
    if (seenSlots.has(slot)) {
      return { ok: false, error: "Duplicate place slot" };
    }
    seenSlots.add(slot);

    const placeId = typeof e.placeId === "number" ? e.placeId : NaN;
    if (!Number.isInteger(placeId)) {
      return { ok: false, error: "Invalid place" };
    }
    entries.push({ slot, placeId });
  }

  return { ok: true, value: { entries } };
}

export function validateEntertainmentPayload(body: unknown): Result<EntertainmentPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const entries: EntertainmentPayload["entries"] = [];
  for (const e of input) {
    const entertainmentId = typeof e.entertainmentId === "number" ? e.entertainmentId : NaN;
    if (!Number.isInteger(entertainmentId)) {
      return { ok: false, error: "Invalid entertainment selection" };
    }
    entries.push({
      entertainmentId,
      durationMinutes: typeof e.durationMinutes === "number" ? e.durationMinutes : null,
      notes: typeof e.notes === "string" && e.notes.trim() ? e.notes.trim() : null,
    });
  }

  return { ok: true, value: { entries } };
}

export function validateMoviesPayload(body: unknown): Result<MoviesPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const entries: MoviesPayload["entries"] = [];
  for (const e of input) {
    const movieId = typeof e.movieId === "number" ? e.movieId : NaN;
    if (!Number.isInteger(movieId)) {
      return { ok: false, error: "Invalid movie selection" };
    }

    let rating: number | null = null;
    if (e.rating !== null && e.rating !== undefined) {
      const r = typeof e.rating === "number" ? e.rating : NaN;
      if (!Number.isInteger(r) || r < 1 || r > 10) {
        return { ok: false, error: "Rating must be a whole number between 1 and 10" };
      }
      rating = r;
    }

    const locationType =
      typeof e.locationType === "string" && e.locationType.trim() ? e.locationType.trim() : null;
    entries.push({ movieId, rating, locationType });
  }

  return { ok: true, value: { entries } };
}

const INVALID_ID = Symbol("invalid-id");
function optionalIntId(value: unknown): number | null | typeof INVALID_ID {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : NaN;
  return Number.isInteger(n) ? n : INVALID_ID;
}

export function validateSportsPayload(body: unknown): Result<SportsPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const entries: SportsPayload["entries"] = [];
  for (const e of input) {
    const sportId = typeof e.sportId === "number" ? e.sportId : NaN;
    if (!Number.isInteger(sportId)) {
      return { ok: false, error: "Invalid sport selection" };
    }

    const leagueId = optionalIntId(e.leagueId);
    if (leagueId === INVALID_ID) return { ok: false, error: "Invalid league selection" };
    const homeTeamId = optionalIntId(e.homeTeamId);
    if (homeTeamId === INVALID_ID) return { ok: false, error: "Invalid home team selection" };
    const awayTeamId = optionalIntId(e.awayTeamId);
    if (awayTeamId === INVALID_ID) return { ok: false, error: "Invalid away team selection" };

    const season = typeof e.season === "string" && e.season.trim() ? e.season.trim() : null;
    const gameType = typeof e.gameType === "string" && e.gameType.trim() ? e.gameType.trim() : null;
    const locationType =
      typeof e.locationType === "string" && e.locationType.trim() ? e.locationType.trim() : null;
    const watchedLive = e.watchedLive === true;
    const durationMinutes = typeof e.durationMinutes === "number" ? e.durationMinutes : null;

    entries.push({
      sportId,
      leagueId,
      season,
      gameType,
      homeTeamId,
      awayTeamId,
      watchedLive,
      durationMinutes,
      locationType,
    });
  }

  return { ok: true, value: { entries } };
}

export function validateBooksPayload(body: unknown): Result<BooksPayload> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;

  const input = Array.isArray(b.entries) ? (b.entries as Record<string, unknown>[]) : [];
  const entries: BooksPayload["entries"] = [];
  for (const e of input) {
    const bookId = typeof e.bookId === "number" ? e.bookId : NaN;
    if (!Number.isInteger(bookId)) {
      return { ok: false, error: "Invalid book selection" };
    }

    const startPage = typeof e.startPage === "number" ? e.startPage : null;
    const endPage = typeof e.endPage === "number" ? e.endPage : null;
    if (startPage !== null && (!Number.isInteger(startPage) || startPage < 0)) {
      return { ok: false, error: "Start page must be a whole number" };
    }
    if (endPage !== null && (!Number.isInteger(endPage) || endPage < 0)) {
      return { ok: false, error: "End page must be a whole number" };
    }

    const completed = e.completed === true;
    const locationType =
      typeof e.locationType === "string" && e.locationType.trim() ? e.locationType.trim() : null;
    const durationMinutes = typeof e.durationMinutes === "number" ? e.durationMinutes : null;

    entries.push({ bookId, startPage, endPage, completed, locationType, durationMinutes });
  }

  return { ok: true, value: { entries } };
}

// Unlike people/places/entertainment's "+ New" modals, a new movie isn't
// hand-typed — the client only ever sends a tmdbId (picked from a TMDB
// search result); the rest of the catalog row is fetched server-side (see
// src/app/api/movies/route.ts) so metadata always matches TMDB rather than
// whatever a user might mistype.
export function validateMovieCatalogRequest(body: unknown): Result<{ tmdbId: number }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const tmdbId = typeof b.tmdbId === "number" ? b.tmdbId : NaN;
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return { ok: false, error: "Invalid tmdbId" };
  }
  return { ok: true, value: { tmdbId } };
}

// Same shape as validateMovieCatalogRequest — a new book is added by
// googleBooksId only, never by hand-typed fields.
export function validateBookCatalogRequest(body: unknown): Result<{ googleBooksId: string }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const googleBooksId = typeof b.googleBooksId === "string" ? b.googleBooksId.trim() : "";
  if (!googleBooksId) {
    return { ok: false, error: "Invalid googleBooksId" };
  }
  return { ok: true, value: { googleBooksId } };
}

type PersonCatalogInput = {
  name: string;
  nicknames: string[];
  birthdate: string | null;
  gender: string | null;
  tagId: number | null;
};

// Only `name` is required — the legacy "New Person" modal treated
// nicknames/birthdate/gender/tag as optional extras, not gatekeeping fields.
// `tagId` replaces the old free-text `tag` string — see the `tags` table
// comment in schema.ts for why (a real catalog now, not a scalar).
export function validatePersonCatalogEntry(body: unknown): Result<PersonCatalogInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };

  const nicknames = Array.isArray(b.nicknames)
    ? (b.nicknames as unknown[])
        .filter((n): n is string => typeof n === "string" && n.trim() !== "")
        .map((n) => n.trim())
    : [];
  const birthdate = typeof b.birthdate === "string" && b.birthdate.trim() ? b.birthdate.trim() : null;
  const gender = typeof b.gender === "string" && b.gender.trim() ? b.gender.trim() : null;

  let tagId: number | null = null;
  if (b.tagId !== null && b.tagId !== undefined) {
    if (typeof b.tagId !== "number" || !Number.isInteger(b.tagId)) {
      return { ok: false, error: "Invalid tagId" };
    }
    tagId = b.tagId;
  }

  return { ok: true, value: { name, nicknames, birthdate, gender, tagId } };
}

type PlaceCatalogInput = {
  name: string;
  alias: string | null;
  address: string | null;
  category: string | null;
  subcategory: string | null;
  parentId: number | null;
  subregionName: string | null;
  color: string | null;
  metroId: number | null;
};

// Same "only name is required" rule as people — everything else is the
// legacy "New Place" modal's optional extras. `category`/`subcategory` stay
// plain free-text (see the `places` table comment in schema.ts for why —
// legacy itself never stored these as references either); `parentId`/
// `subregionName`/`color`/`metroId` are the real hierarchy fields legacy's
// `world` collection carried. `lat`/`lng` are deliberately NOT accepted
// here — they're computed server-side via geocoding (see
// createPlaceCatalogEntry/updatePlaceCatalogEntry below), never
// client-supplied.
export function validatePlaceCatalogEntry(body: unknown): Result<PlaceCatalogInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };

  const alias = typeof b.alias === "string" && b.alias.trim() ? b.alias.trim() : null;
  const address = typeof b.address === "string" && b.address.trim() ? b.address.trim() : null;
  const category = typeof b.category === "string" && b.category.trim() ? b.category.trim() : null;
  const subcategory = typeof b.subcategory === "string" && b.subcategory.trim() ? b.subcategory.trim() : null;
  const subregionName =
    typeof b.subregionName === "string" && b.subregionName.trim() ? b.subregionName.trim() : null;
  const color = typeof b.color === "string" && b.color.trim() ? b.color.trim() : null;

  let parentId: number | null = null;
  if (b.parentId !== null && b.parentId !== undefined) {
    if (typeof b.parentId !== "number" || !Number.isInteger(b.parentId)) {
      return { ok: false, error: "Invalid parentId" };
    }
    parentId = b.parentId;
  }

  let metroId: number | null = null;
  if (b.metroId !== null && b.metroId !== undefined) {
    if (typeof b.metroId !== "number" || !Number.isInteger(b.metroId)) {
      return { ok: false, error: "Invalid metroId" };
    }
    metroId = b.metroId;
  }

  return { ok: true, value: { name, alias, address, category, subcategory, parentId, subregionName, color, metroId } };
}

export function validateExerciseCatalogEntry(
  body: unknown
): Result<{ name: string; category: ExerciseCategory }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  if (!EXERCISE_CATEGORIES.has(b.category as string)) {
    return { ok: false, error: "Invalid category" };
  }
  return { ok: true, value: { name, category: b.category as ExerciseCategory } };
}

export function validateEntertainmentCatalogEntry(
  body: unknown
): Result<{ kind: EntertainmentKind; title: string; detail: string | null }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required" };
  if (!ENTERTAINMENT_KINDS.has(b.kind as string)) {
    return { ok: false, error: "Invalid kind" };
  }
  const detail = typeof b.detail === "string" && b.detail.trim() ? b.detail.trim() : null;
  return { ok: true, value: { kind: b.kind as EntertainmentKind, title, detail } };
}

/**
 * Replaces a day's workouts (and their sets) wholesale with the given list.
 * Not wrapped in a DB transaction: the neon-http driver (chosen so
 * src/lib/db.ts can create its client lazily and stay friendly to
 * Vercel's serverless/edge functions) only supports single-round-trip
 * batches, not interactive transactions — and a batch can't thread a
 * freshly-inserted workout's generated id into its sets insert. So this is
 * a sequence of awaited statements, not one atomic unit. Acceptable for a
 * single-writer personal app — the legacy app had the same kind of
 * no-consistency-guarantee fan-out on every save.
 */
async function replaceWorkouts(date: string, list: WorkoutPayload[]): Promise<void> {
  const db = getDb();

  await db.delete(workouts).where(eq(workouts.date, date));

  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    const [inserted] = await db
      .insert(workouts)
      .values({
        date,
        sortOrder: i,
        exerciseId: w.exerciseId,
        locationId: w.locationId,
        subtype: w.subtype,
        dataSource: w.dataSource,
        durationMinutes: w.durationMinutes,
        distanceKm: w.distanceKm,
        effort: w.effort,
      })
      .returning({ id: workouts.id });

    if (w.sets.length > 0) {
      await db.insert(workoutSets).values(
        w.sets.map((s) => ({
          workoutId: inserted.id,
          setNumber: s.setNumber,
          reps: s.reps,
          weightLbs: s.weightLbs,
          durationSeconds: s.durationSeconds,
        }))
      );
    }
  }
}

// Each saveX function below is a partial upsert: it only touches its own
// section's columns on `days`, via onConflictDoUpdate's `set` listing just
// those columns. On a brand-new day (no existing row) every other column
// is nullable (or has a default), so inserting just one section's slice
// leaves the rest unset rather than clobbering them — this is what lets
// each section's entry page save completely independently of the others,
// mirroring the legacy app's one-page-per-category forms.

export async function saveHealth(date: string, value: HealthPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      distanceWalkedKm: value.distanceWalkedKm,
      coffees: value.coffees,
      sick: value.sick,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        distanceWalkedKm: value.distanceWalkedKm,
        coffees: value.coffees,
        sick: value.sick,
        updatedAt: new Date(),
      },
    });

  await replaceWorkouts(date, value.workouts);

  return loadDay(date);
}

export async function saveSleep(date: string, value: SleepPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      sleepTime: value.sleepTime,
      wakeTime: value.wakeTime,
      wakeCrossedMidnight: value.wakeCrossedMidnight,
      sleepLocationType: value.sleepLocationType,
      sleepLocationSubtype: value.sleepLocationSubtype,
      napMinutes: value.napMinutes,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        sleepTime: value.sleepTime,
        wakeTime: value.wakeTime,
        wakeCrossedMidnight: value.wakeCrossedMidnight,
        sleepLocationType: value.sleepLocationType,
        sleepLocationSubtype: value.sleepLocationSubtype,
        napMinutes: value.napMinutes,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

export async function saveHappiness(date: string, value: HappinessPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      happiness: value.happiness,
      happinessReason: value.happinessReason,
      journal: value.journal,
      dayType: value.dayType,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        happiness: value.happiness,
        happinessReason: value.happinessReason,
        journal: value.journal,
        dayType: value.dayType,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

export async function saveWork(date: string, value: WorkPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      productivity: value.productivity,
      workDurationMinutes: value.workDurationMinutes,
      workLocation: value.workLocation,
      commute: value.commute,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        productivity: value.productivity,
        workDurationMinutes: value.workDurationMinutes,
        workLocation: value.workLocation,
        commute: value.commute,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

export async function saveTechnology(date: string, value: TechnologyPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      phoneUsageMinutes: value.phoneUsageMinutes,
      laptopUsageMinutes: value.laptopUsageMinutes,
      instagramUsageMinutes: value.instagramUsageMinutes,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        phoneUsageMinutes: value.phoneUsageMinutes,
        laptopUsageMinutes: value.laptopUsageMinutes,
        instagramUsageMinutes: value.instagramUsageMinutes,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

export async function saveWeight(date: string, value: WeightPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      weightKg: value.weightKg,
      bodyFatPercent: value.bodyFatPercent,
      muscleMassKg: value.muscleMassKg,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        weightKg: value.weightKg,
        bodyFatPercent: value.bodyFatPercent,
        muscleMassKg: value.muscleMassKg,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

export async function saveSocialMedia(date: string, value: SocialMediaPayload): Promise<DayPayload> {
  const db = getDb();

  await db
    .insert(days)
    .values({
      date,
      instagramFollowers: value.instagramFollowers,
      instagramFollowing: value.instagramFollowing,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: days.date,
      set: {
        instagramFollowers: value.instagramFollowers,
        instagramFollowing: value.instagramFollowing,
        updatedAt: new Date(),
      },
    });

  return loadDay(date);
}

// Subs/people/places are fixed-count (see POSITIVE_PEOPLE_SLOTS/
// NEGATIVE_PEOPLE_SLOTS/PLACE_SLOTS/SUB_NAMES above), so — like every other
// section — they're partial upserts straight onto `days`'s own columns, no
// satellite table involved. Entertainment is the one remaining section with
// no scalar day-row fields of its own: it's genuinely open-ended, so saving
// it stays a replace-on-save against its own satellite table, and needs the
// day row to exist first (bare, via ensureDayRow) so its FK has something
// to reference.

async function ensureDayRow(date: string): Promise<void> {
  const db = getDb();
  await db.insert(days).values({ date }).onConflictDoNothing({ target: days.date });
}

export async function saveSubs(date: string, value: SubsPayload): Promise<DayPayload> {
  const db = getDb();

  const byName = new Map(value.entries.map((e) => [e.name, e.value]));
  const columns = {
    subA: byName.get("A") ?? null,
    subW: byName.get("W") ?? null,
    subC: byName.get("C") ?? null,
    subL: byName.get("L") ?? null,
    subNi: byName.get("Ni") ?? null,
    subNO: byName.get("NO") ?? null,
    subAd: byName.get("Ad") ?? null,
    subD: byName.get("D") ?? null,
    subK: byName.get("K") ?? null,
  };

  await db
    .insert(days)
    .values({ date, ...columns, updatedAt: new Date() })
    .onConflictDoUpdate({ target: days.date, set: { ...columns, updatedAt: new Date() } });

  return loadDay(date);
}

export async function savePeople(date: string, value: PeoplePayload): Promise<DayPayload> {
  const db = getDb();

  const positive: (number | null)[] = Array(POSITIVE_PEOPLE_SLOTS).fill(null);
  const negative: (number | null)[] = Array(NEGATIVE_PEOPLE_SLOTS).fill(null);
  for (const e of value.entries) {
    if (e.valence === "positive" && e.slot < POSITIVE_PEOPLE_SLOTS) positive[e.slot] = e.personId;
    if (e.valence === "negative" && e.slot < NEGATIVE_PEOPLE_SLOTS) negative[e.slot] = e.personId;
  }

  const columns = {
    positivePerson1Id: positive[0],
    positivePerson2Id: positive[1],
    positivePerson3Id: positive[2],
    positivePerson4Id: positive[3],
    positivePerson5Id: positive[4],
    positivePerson6Id: positive[5],
    positivePerson7Id: positive[6],
    negativePerson1Id: negative[0],
    negativePerson2Id: negative[1],
    negativePerson3Id: negative[2],
  };

  await db
    .insert(days)
    .values({ date, ...columns, updatedAt: new Date() })
    .onConflictDoUpdate({ target: days.date, set: { ...columns, updatedAt: new Date() } });

  return loadDay(date);
}

export async function savePlaces(date: string, value: PlacesPayload): Promise<DayPayload> {
  const db = getDb();

  const slots: (number | null)[] = Array(PLACE_SLOTS).fill(null);
  for (const e of value.entries) {
    if (e.slot < PLACE_SLOTS) slots[e.slot] = e.placeId;
  }

  const columns = {
    place1Id: slots[0],
    place2Id: slots[1],
  };

  await db
    .insert(days)
    .values({ date, ...columns, updatedAt: new Date() })
    .onConflictDoUpdate({ target: days.date, set: { ...columns, updatedAt: new Date() } });

  return loadDay(date);
}

export async function saveEntertainment(date: string, value: EntertainmentPayload): Promise<DayPayload> {
  const db = getDb();
  await ensureDayRow(date);

  await db.delete(entertainmentEntries).where(eq(entertainmentEntries.date, date));
  if (value.entries.length > 0) {
    await db.insert(entertainmentEntries).values(
      value.entries.map((e, i) => ({
        date,
        entertainmentId: e.entertainmentId,
        durationMinutes: e.durationMinutes,
        notes: e.notes,
        sortOrder: i,
      }))
    );
  }

  return loadDay(date);
}

// Same replace-on-save shape as saveEntertainment above (open-ended, needs
// the day row to exist first via ensureDayRow), just against the
// movie_watches satellite table instead.
export async function saveMovies(date: string, value: MoviesPayload): Promise<DayPayload> {
  const db = getDb();
  await ensureDayRow(date);

  await db.delete(movieWatches).where(eq(movieWatches.date, date));
  if (value.entries.length > 0) {
    await db.insert(movieWatches).values(
      value.entries.map((e) => ({
        date,
        movieId: e.movieId,
        rating: e.rating,
        locationType: e.locationType,
      }))
    );
  }

  return loadDay(date);
}

// Same replace-on-save shape as saveMovies above, against the
// sports_watches satellite table.
export async function saveSportsWatches(date: string, value: SportsPayload): Promise<DayPayload> {
  const db = getDb();
  await ensureDayRow(date);

  await db.delete(sportsWatches).where(eq(sportsWatches.date, date));
  if (value.entries.length > 0) {
    await db.insert(sportsWatches).values(
      value.entries.map((e) => ({
        date,
        sportId: e.sportId,
        leagueId: e.leagueId,
        season: e.season,
        gameType: e.gameType,
        homeTeamId: e.homeTeamId,
        awayTeamId: e.awayTeamId,
        watchedLive: e.watchedLive,
        durationMinutes: e.durationMinutes,
        locationType: e.locationType,
      }))
    );
  }

  return loadDay(date);
}

// Same replace-on-save shape as saveMovies/saveSportsWatches above, against
// the book_reading_sessions satellite table.
export async function saveBookReadingSessions(date: string, value: BooksPayload): Promise<DayPayload> {
  const db = getDb();
  await ensureDayRow(date);

  await db.delete(bookReadingSessions).where(eq(bookReadingSessions.date, date));
  if (value.entries.length > 0) {
    await db.insert(bookReadingSessions).values(
      value.entries.map((e) => ({
        date,
        bookId: e.bookId,
        startPage: e.startPage,
        endPage: e.endPage,
        completed: e.completed,
        locationType: e.locationType,
        durationMinutes: e.durationMinutes,
      }))
    );
  }

  return loadDay(date);
}

// --- Catalogs --------------------------------------------------------------
// People/places/exercises/exercise-locations/entertainment all follow the
// same "pick from a maintained list, add new via a quick create" pattern
// instead of free text. Every create function is an upsert-by-name (or
// upsert-by-(category,name) / (kind,title) where the catalog needs a
// compound identity) rather than a plain insert: typing a name that
// already exists just selects the existing catalog row instead of erroring
// or creating a duplicate, which matters for a quick "+ New" modal where
// erroring on an accidental re-type would be an annoying dead end.

const PERSON_COLUMNS = {
  id: people.id,
  name: people.name,
  nicknames: people.nicknames,
  birthdate: people.birthdate,
  gender: people.gender,
  tagId: people.tagId,
};

// Every person read resolves its tag via a left join against `tags` rather
// than trusting a denormalized copy — legacy kept the tag *name* on the
// person doc directly and had to rewrite every member's document whenever
// a tag was renamed; a real FK means there's nothing to keep in sync.
function selectPeopleWithTag() {
  const db = getDb();
  return db
    .select({ ...PERSON_COLUMNS, tagName: tags.name, tagColor: tags.color })
    .from(people)
    .leftJoin(tags, eq(people.tagId, tags.id));
}

export async function listPeopleCatalog(): Promise<PersonCatalogItem[]> {
  return selectPeopleWithTag().orderBy(asc(people.name));
}

export async function createPersonCatalogEntry(input: PersonCatalogInput): Promise<PersonCatalogItem> {
  const db = getDb();
  const trimmed = input.name.trim();
  const [inserted] = await db
    .insert(people)
    .values({
      name: trimmed,
      nicknames: input.nicknames,
      birthdate: input.birthdate,
      gender: input.gender,
      tagId: input.tagId,
    })
    .onConflictDoNothing({ target: people.name })
    .returning({ id: people.id });
  const id = inserted?.id ?? (await db.select({ id: people.id }).from(people).where(eq(people.name, trimmed)))[0].id;
  const item = await getPersonCatalogEntry(id);
  return item as PersonCatalogItem; // just inserted or found by name above — always exists
}

// --- Catalog administration --------------------------------------------
// Get-one/update/delete + a "where is this used" usage check per catalog,
// for the /manage pages (src/app/manage/**) — the legacy app's "database"
// section, where you go to fix a typo'd name or retire something you don't
// use anymore, as opposed to the entry forms' "+ New" which only ever adds.
// Every delete is preceded by a usage check so the UI can block (or warn
// about) removing something still referenced, mirroring the legacy app's
// person.js delete flow — see the comment above each usage function for
// which FK columns actually enforce that at the DB level (`restrict`) versus
// which just get nulled out (`set null`, e.g. a workout's location).

export async function getPersonCatalogEntry(id: number): Promise<PersonCatalogItem | null> {
  const [row] = await selectPeopleWithTag().where(eq(people.id, id));
  return row ?? null;
}

export async function updatePersonCatalogEntry(
  id: number,
  input: PersonCatalogInput
): Promise<PersonCatalogItem> {
  const db = getDb();
  await db
    .update(people)
    .set({
      name: input.name.trim(),
      nicknames: input.nicknames,
      birthdate: input.birthdate,
      gender: input.gender,
      tagId: input.tagId,
    })
    .where(eq(people.id, id));
  const item = await getPersonCatalogEntry(id);
  return item as PersonCatalogItem;
}

export type PersonUsage = { dates: string[] };

// A person is referenced by the 7 positive + 3 negative slot columns on
// `days` (onDelete: "restrict" on every one — the DB itself would refuse
// the delete too, this just lets the UI explain why and link to the days).
// Note this is about a person being *mentioned on a day*, not about their
// tag — a person's tagId is onDelete: "restrict" from the *tags* side (see
// getTagUsage in src/lib/catalog-admin.ts), which blocks deleting a TAG
// that still has members, not deleting a member itself.
export async function getPersonUsage(id: number): Promise<PersonUsage> {
  const db = getDb();
  const rows = await db
    .select({ date: days.date })
    .from(days)
    .where(
      or(
        eq(days.positivePerson1Id, id),
        eq(days.positivePerson2Id, id),
        eq(days.positivePerson3Id, id),
        eq(days.positivePerson4Id, id),
        eq(days.positivePerson5Id, id),
        eq(days.positivePerson6Id, id),
        eq(days.positivePerson7Id, id),
        eq(days.negativePerson1Id, id),
        eq(days.negativePerson2Id, id),
        eq(days.negativePerson3Id, id)
      )
    )
    .orderBy(asc(days.date));
  return { dates: rows.map((r) => r.date) };
}

export async function deletePersonCatalogEntry(id: number): Promise<void> {
  const db = getDb();
  await db.delete(people).where(eq(people.id, id));
}

const PLACE_COLUMNS = {
  id: places.id,
  name: places.name,
  alias: places.alias,
  address: places.address,
  category: places.category,
  subcategory: places.subcategory,
  parentId: places.parentId,
  subregionName: places.subregionName,
  color: places.color,
  idPath: places.idPath,
  namePath: places.namePath,
  metroId: places.metroId,
  lat: places.lat,
  lng: places.lng,
};

export async function listPlacesCatalog(): Promise<PlaceCatalogItem[]> {
  const db = getDb();
  return db.select(PLACE_COLUMNS).from(places).orderBy(asc(places.name));
}

// --- place path (idPath/namePath) maintenance ------------------------------
// See the `places` table comment in schema.ts for what these are and why
// they're maintained here instead of computed on read.

type PlacePathParts = { idPath: string; namePath: string };

function buildPlacePath(parent: PlacePathParts | null, id: number, name: string): PlacePathParts {
  return {
    idPath: `${parent?.idPath ?? ""}${id}/`,
    namePath: `${parent?.namePath ?? ""}${name}/`,
  };
}

async function fetchPlacePathParts(id: number): Promise<PlacePathParts | null> {
  const db = getDb();
  const [row] = await db.select({ idPath: places.idPath, namePath: places.namePath }).from(places).where(eq(places.id, id));
  if (!row) return null;
  // Falls back to "" (not the parent's own path) if the parent hasn't been
  // backfilled/re-saved yet — see scripts/backfill-place-paths.mjs. A path
  // built on top of an un-backfilled ancestor will be wrong until that
  // ancestor gets backfilled or re-saved; there's no way to detect that
  // from here, so the backfill script is meant to run once, top-down,
  // right after this column is added.
  return { idPath: row.idPath ?? "", namePath: row.namePath ?? "" };
}

// Recomputes `root`'s own idPath/namePath (already reflected in `root`) down
// through every descendant, level by level, so a rename or a re-parent
// propagates all the way down the subtree. `root.idPath`/`root.namePath`
// must already be the freshly-saved values for the root place itself.
async function cascadePlacePaths(root: { id: number; idPath: string; namePath: string }): Promise<void> {
  const db = getDb();
  // Same cycle guard as getPlaceDescendantIds above, for the same reason —
  // without it a corrupted parent_id ring below `root` would keep
  // re-visiting itself (and re-writing the same rows) forever instead of
  // this function ever returning.
  const visited = new Set<number>([root.id]);
  let frontier = [root];
  while (frontier.length > 0) {
    const parentIds = frontier.map((p) => p.id);
    const children = await db
      .select({ id: places.id, name: places.name, parentId: places.parentId })
      .from(places)
      .where(inArray(places.parentId, parentIds));
    if (children.length === 0) break;
    const parentById = new Map(frontier.map((p) => [p.id, p]));
    const nextFrontier: typeof frontier = [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      const parent = parentById.get(child.parentId as number);
      if (!parent) continue;
      const { idPath, namePath } = buildPlacePath(parent, child.id, child.name);
      await db.update(places).set({ idPath, namePath }).where(eq(places.id, child.id));
      nextFrontier.push({ id: child.id, idPath, namePath });
    }
    frontier = nextFrontier;
  }
}

// Geocoding is a best-effort enhancement, not a gate on saving a place — a
// missing GOOGLE_MAPS_API_KEY, an address that doesn't resolve, or a
// network hiccup all just leave lat/lng unset rather than failing the
// create/update. See src/lib/geocode.ts for the "only when address
// actually changed" reasoning (fixing a real legacy bug, not carrying it
// forward).
async function geocodeOrNull(address: string | null): Promise<{ lat: number | null; lng: number | null }> {
  if (!address) return { lat: null, lng: null };
  try {
    const result = await geocodeAddress(address);
    return { lat: result?.lat ?? null, lng: result?.lng ?? null };
  } catch {
    return { lat: null, lng: null };
  }
}

// Legacy's own root-creation flow only ever produced places with
// category "Region" at the top of the tree (new_place_form.ejs's "Add New
// Country" button opens a modal literally titled "New Region" — country
// and top-level region are the same category, just different UI labels for
// the same action; migrate-history.mjs's `category === "Region"` address
// computation reflects the same convention). Unlike the color/metro
// inheritance rules below (deliberately UI-only, per the `places`/`metros`
// comments in schema.ts), this is enforced here so a stray venue or city
// can't accidentally end up parentless.
function assertValidRoot(category: string | null, parentId: number | null): void {
  if (parentId === null && category !== "Region") {
    throw new Error('Only a "Region" place can be top-level (no parent) — set a parent, or set category to "Region".');
  }
}

export async function createPlaceCatalogEntry(input: PlaceCatalogInput): Promise<PlaceCatalogItem> {
  assertValidRoot(input.category, input.parentId);
  const db = getDb();
  const trimmed = input.name.trim();
  const { lat, lng } = await geocodeOrNull(input.address);
  const [inserted] = await db
    .insert(places)
    .values({
      name: trimmed,
      alias: input.alias,
      address: input.address,
      category: input.category,
      subcategory: input.subcategory,
      parentId: input.parentId,
      subregionName: input.subregionName,
      color: input.color,
      metroId: input.metroId,
      lat,
      lng,
    })
    // Dedup target is (name, parentId), not name alone — a name can
    // legitimately repeat at a different spot in the tree (see the `places`
    // table comment in schema.ts), so only a same-name place at the exact
    // same parent counts as "already exists".
    .onConflictDoNothing({ target: [places.name, places.parentId] })
    .returning(PLACE_COLUMNS);
  if (!inserted) {
    // Name+parent collision — onConflictDoNothing left the existing row
    // untouched, it already has a path (or will once backfilled).
    const [existing] = await db
      .select(PLACE_COLUMNS)
      .from(places)
      .where(
        and(
          eq(places.name, trimmed),
          input.parentId === null ? isNull(places.parentId) : eq(places.parentId, input.parentId)
        )
      );
    return existing;
  }

  const parentPath = inserted.parentId !== null ? await fetchPlacePathParts(inserted.parentId) : null;
  const { idPath, namePath } = buildPlacePath(parentPath, inserted.id, inserted.name);
  const [withPath] = await db
    .update(places)
    .set({ idPath, namePath })
    .where(eq(places.id, inserted.id))
    .returning(PLACE_COLUMNS);
  return withPath;
}

export async function getPlaceCatalogEntry(id: number): Promise<PlaceCatalogItem | null> {
  const db = getDb();
  const [row] = await db.select(PLACE_COLUMNS).from(places).where(eq(places.id, id));
  return row ?? null;
}

// Recursive (iterative, BFS) walk down `parentId` — small dataset (low
// thousands of places at most for a personal app), so a handful of batched
// queries beats reaching for a raw recursive SQL CTE here. Used to guard
// against moving a place into its own subtree (updatePlaceCatalogEntry
// below) and to block deleting a place that still has descendants
// (getPlaceUsage below) — both real behaviors legacy's world.js had
// (its `submitWorldEdit`'s "can't move into your own subtree" guard, and
// places.js's descendant check before delete), just computed on read here
// instead of maintained on write.
export async function getPlaceDescendantIds(id: number): Promise<number[]> {
  const db = getDb();
  const result: number[] = [];
  // A corrupted parent_id cycle (shouldn't happen given
  // updatePlaceCatalogEntry's check below, but see
  // scripts/diagnose-place-cycles.mjs for how one has slipped in before)
  // would otherwise make this loop forever, re-discovering the same ring
  // of places every pass — `visited` guarantees each place is only ever
  // queued once, so a cycle just gets silently skipped past instead.
  const visited = new Set<number>([id]);
  let frontier = [id];
  while (frontier.length > 0) {
    const children = await db.select({ id: places.id }).from(places).where(inArray(places.parentId, frontier));
    const childIds = children.map((c) => c.id).filter((childId) => !visited.has(childId));
    for (const childId of childIds) visited.add(childId);
    result.push(...childIds);
    frontier = childIds;
  }
  return result;
}

// Ancestor chain from root to `id` inclusive, walked up on read — used for
// the interactive breadcrumb (src/components/manage/place-detail.tsx),
// which needs each ancestor's own id to link to it, not just its name. The
// maintained `namePath`/`idPath` columns (see the `places` table comment
// in schema.ts) cover the flat-string path/search use case; this covers
// the "clickable per-ancestor" one they can't. A guard against a corrupted
// cycle (shouldn't happen given updatePlaceCatalogEntry's check below, but
// this reads defensively regardless) stops it from looping forever if one
// ever exists.
//
// Also carries category/subcategory/color for every ancestor (not just
// id/name) — place-detail.tsx uses these to find the two ancestors that
// gate color and metro (root's color; nearest category=Region &&
// subcategory=Municipality ancestor's metro — see the `places`/`metros`
// table comments in schema.ts) without a second round-trip.
type PlaceParentLookupRow = {
  id: number;
  name: string;
  parentId: number | null;
  category: string | null;
  subcategory: string | null;
  color: string | null;
  metroId: number | null;
};

async function fetchPlaceParentLookup(placeId: number): Promise<PlaceParentLookupRow | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: places.id,
      name: places.name,
      parentId: places.parentId,
      category: places.category,
      subcategory: places.subcategory,
      color: places.color,
      metroId: places.metroId,
    })
    .from(places)
    .where(eq(places.id, placeId));
  return row ?? null;
}

export type PlaceAncestor = {
  id: number;
  name: string;
  category: string | null;
  subcategory: string | null;
  color: string | null;
  metroId: number | null;
};

export async function getPlaceAncestry(id: number): Promise<PlaceAncestor[]> {
  const chain: PlaceAncestor[] = [];
  const visited = new Set<number>();
  let currentId: number | null = id;
  while (currentId !== null) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const row: PlaceParentLookupRow | null = await fetchPlaceParentLookup(currentId);
    if (!row) break;
    chain.unshift({
      id: row.id,
      name: row.name,
      category: row.category,
      subcategory: row.subcategory,
      color: row.color,
      metroId: row.metroId,
    });
    currentId = row.parentId;
  }
  return chain;
}

export async function getPlaceChildren(id: number): Promise<PlaceCatalogItem[]> {
  const db = getDb();
  return db.select(PLACE_COLUMNS).from(places).where(eq(places.parentId, id)).orderBy(asc(places.name));
}

export async function updatePlaceCatalogEntry(id: number, input: PlaceCatalogInput): Promise<PlaceCatalogItem> {
  assertValidRoot(input.category, input.parentId);
  const db = getDb();

  if (input.parentId !== null) {
    if (input.parentId === id) {
      throw new Error("A place can't be its own parent");
    }
    const descendantIds = await getPlaceDescendantIds(id);
    if (descendantIds.includes(input.parentId)) {
      throw new Error("Can't move a place into its own subtree");
    }
  }

  const [existing] = await db
    .select({ address: places.address, name: places.name, parentId: places.parentId })
    .from(places)
    .where(eq(places.id, id));
  // Only re-geocode when the address actually changed — the whole point of
  // fixing legacy's "re-geocode on every save regardless" bug (see
  // src/lib/geocode.ts).
  const addressChanged = existing?.address !== input.address;
  const geo = addressChanged ? await geocodeOrNull(input.address) : null;

  const trimmedName = input.name.trim();
  // A rename or a re-parent both change this place's own idPath/namePath,
  // and every descendant's too (cascaded below) — anything else about the
  // place doesn't touch path at all.
  const pathAffectingChange = existing?.name !== trimmedName || existing?.parentId !== input.parentId;

  const [updated] = await db
    .update(places)
    .set({
      name: trimmedName,
      alias: input.alias,
      address: input.address,
      category: input.category,
      subcategory: input.subcategory,
      parentId: input.parentId,
      subregionName: input.subregionName,
      color: input.color,
      metroId: input.metroId,
      ...(geo ? { lat: geo.lat, lng: geo.lng } : {}),
    })
    .where(eq(places.id, id))
    .returning(PLACE_COLUMNS);

  if (!pathAffectingChange) return updated;

  const parentPath = updated.parentId !== null ? await fetchPlacePathParts(updated.parentId) : null;
  const { idPath, namePath } = buildPlacePath(parentPath, updated.id, updated.name);
  const [withPath] = await db
    .update(places)
    .set({ idPath, namePath })
    .where(eq(places.id, updated.id))
    .returning(PLACE_COLUMNS);
  await cascadePlacePaths({ id: withPath.id, idPath, namePath });
  return withPath;
}

// A place is referenced three ways: as one of a day's 2 place slots
// (onDelete: "restrict" — blocks deletion), as a workout's location
// (onDelete: "set null" — deleting the place just clears that field on the
// workout rather than blocking, since a location is a minor, forgettable
// detail of a workout in a way a day's actual place isn't), and as another
// place's parent (onDelete: "restrict" — a place with children can't be
// deleted until they're moved or deleted first, same reasoning as legacy's
// places.js descendant check before delete). `workoutDates` is reported as
// a warning, not a hard block; `dayDates` and `childCount` both block.
export type PlaceUsage = { dayDates: string[]; workoutDates: string[]; childCount: number };

export async function getPlaceUsage(id: number): Promise<PlaceUsage> {
  const db = getDb();
  const [dayRows, workoutRows, childRows] = await Promise.all([
    db
      .select({ date: days.date })
      .from(days)
      .where(or(eq(days.place1Id, id), eq(days.place2Id, id)))
      .orderBy(asc(days.date)),
    db.select({ date: workouts.date }).from(workouts).where(eq(workouts.locationId, id)).orderBy(asc(workouts.date)),
    db.select({ id: places.id }).from(places).where(eq(places.parentId, id)),
  ]);
  return {
    dayDates: dayRows.map((r) => r.date),
    workoutDates: [...new Set(workoutRows.map((r) => r.date))],
    childCount: childRows.length,
  };
}

export async function deletePlaceCatalogEntry(id: number): Promise<void> {
  const db = getDb();
  await db.delete(places).where(eq(places.id, id));
}

// --- mention history --------------------------------------------------
// Mirrors legacy's place.js `loadMentions` — a place's detail page lists
// every day it was logged in either place slot, with a "Show Descendants"
// toggle that widens the match to the whole subtree (legacy compared each
// day's place against `place.pathStr` as a prefix of the mentioned place's
// own path; this does the same thing via idPath/getPlaceDescendantIds,
// which didn't exist yet when that code was written).

export type PlaceMentionEntry = {
  date: string;
  // "1st & 2nd" only when the SAME place fills both of a day's slots —
  // legacy bolded this case specifically (place.js's `endings[0]`) rather
  // than just always showing both.
  slot: "1st" | "2nd" | "1st & 2nd";
  // The place that actually matched — usually `id` itself, but with
  // includeDescendants it can be any descendant, so the list can show which
  // one (legacy showed this place's own name + a bit of its path).
  placeId: number;
  placeName: string;
};

export async function getPlaceMentionHistory(
  id: number,
  options: { includeDescendants?: boolean } = {}
): Promise<PlaceMentionEntry[]> {
  const db = getDb();
  const matchIds = options.includeDescendants ? [id, ...(await getPlaceDescendantIds(id))] : [id];
  const rows = await db
    .select({ date: days.date, place1Id: days.place1Id, place2Id: days.place2Id })
    .from(days)
    .where(or(inArray(days.place1Id, matchIds), inArray(days.place2Id, matchIds)))
    .orderBy(desc(days.date));
  if (rows.length === 0) return [];

  const matchSet = new Set(matchIds);
  const neededPlaceIds = new Set<number>();
  for (const r of rows) {
    if (r.place1Id !== null && matchSet.has(r.place1Id)) neededPlaceIds.add(r.place1Id);
    if (r.place2Id !== null && matchSet.has(r.place2Id)) neededPlaceIds.add(r.place2Id);
  }
  const nameRows = await db
    .select({ id: places.id, name: places.name })
    .from(places)
    .where(inArray(places.id, [...neededPlaceIds]));
  const nameById = new Map(nameRows.map((r) => [r.id, r.name]));

  const entries: PlaceMentionEntry[] = [];
  for (const r of rows) {
    const match1 = r.place1Id !== null && matchSet.has(r.place1Id);
    const match2 = r.place2Id !== null && matchSet.has(r.place2Id);
    if (match1 && match2 && r.place1Id === r.place2Id) {
      entries.push({ date: r.date, slot: "1st & 2nd", placeId: r.place1Id!, placeName: nameById.get(r.place1Id!) ?? "?" });
      continue;
    }
    if (match1) entries.push({ date: r.date, slot: "1st", placeId: r.place1Id!, placeName: nameById.get(r.place1Id!) ?? "?" });
    if (match2) entries.push({ date: r.date, slot: "2nd", placeId: r.place2Id!, placeName: nameById.get(r.place2Id!) ?? "?" });
  }
  return entries;
}

/** Per-place mention count, own mentions plus every descendant's (a
 * country's count includes every city and venue under it) — used to sort
 * the places manage list by "most mentioned" instead of alphabetically.
 * Reuses the exact 1x-for-1st-slot/0.5x-for-2nd-slot weighting
 * getPlaceLeaderboardData (src/lib/charts.ts) already established, so "how
 * mentioned" means the same thing everywhere in the app rather than two
 * competing definitions. */
export async function getPlaceMentionCounts(): Promise<Map<number, number>> {
  const db = getDb();
  const rows = await db
    .select({
      id: places.id,
      parentId: places.parentId,
      own: sql<number>`
        coalesce(sum(case when ${days.place1Id} = ${places.id} then 1 else 0 end), 0)
        + coalesce(sum(case when ${days.place2Id} = ${places.id} then 0.5 else 0 end), 0)
      `.as("own"),
    })
    .from(places)
    .leftJoin(days, sql`${days.place1Id} = ${places.id} or ${days.place2Id} = ${places.id}`)
    .groupBy(places.id, places.parentId);

  const own = new Map(rows.map((r) => [r.id, Number(r.own)]));
  const childrenByParent = new Map<number, number[]>();
  for (const r of rows) {
    if (r.parentId === null) continue;
    if (!childrenByParent.has(r.parentId)) childrenByParent.set(r.parentId, []);
    childrenByParent.get(r.parentId)!.push(r.id);
  }

  const total = new Map<number, number>();
  // `visiting` catches a corrupted parent_id cycle (shouldn't happen given
  // updatePlaceCatalogEntry's guard, but see scripts/diagnose-place-cycles.mjs
  // for how one has slipped in before) — without it, a place in a cycle
  // recurses into itself before ever getting cached, overflowing the call
  // stack and 500ing this entire page instead of just under-counting the
  // places actually in the loop.
  const visiting = new Set<number>();
  function computeTotal(placeId: number): number {
    const cached = total.get(placeId);
    if (cached !== undefined) return cached;
    if (visiting.has(placeId)) return 0;
    visiting.add(placeId);
    let sum = own.get(placeId) ?? 0;
    for (const childId of childrenByParent.get(placeId) ?? []) {
      sum += computeTotal(childId);
    }
    visiting.delete(placeId);
    total.set(placeId, sum);
    return sum;
  }
  for (const r of rows) computeTotal(r.id);
  return total;
}

const ENTERTAINMENT_CATALOG_COLUMNS = {
  id: entertainmentCatalog.id,
  kind: entertainmentCatalog.kind,
  title: entertainmentCatalog.title,
  detail: entertainmentCatalog.detail,
};

export async function listEntertainmentCatalog(): Promise<EntertainmentCatalogItem[]> {
  const db = getDb();
  return db
    .select(ENTERTAINMENT_CATALOG_COLUMNS)
    .from(entertainmentCatalog)
    .orderBy(asc(entertainmentCatalog.kind), asc(entertainmentCatalog.title));
}

export async function createEntertainmentCatalogEntry(
  kind: EntertainmentKind,
  title: string,
  detail: string | null = null
): Promise<EntertainmentCatalogItem> {
  const db = getDb();
  const trimmed = title.trim();
  const [inserted] = await db
    .insert(entertainmentCatalog)
    .values({ kind, title: trimmed, detail })
    .onConflictDoNothing({ target: [entertainmentCatalog.kind, entertainmentCatalog.title] })
    .returning(ENTERTAINMENT_CATALOG_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db
    .select(ENTERTAINMENT_CATALOG_COLUMNS)
    .from(entertainmentCatalog)
    .where(and(eq(entertainmentCatalog.kind, kind), eq(entertainmentCatalog.title, trimmed)));
  return existing;
}

export async function getEntertainmentCatalogEntry(id: number): Promise<EntertainmentCatalogItem | null> {
  const db = getDb();
  const [row] = await db
    .select(ENTERTAINMENT_CATALOG_COLUMNS)
    .from(entertainmentCatalog)
    .where(eq(entertainmentCatalog.id, id));
  return row ?? null;
}

export async function updateEntertainmentCatalogEntry(
  id: number,
  kind: EntertainmentKind,
  title: string,
  detail: string | null
): Promise<EntertainmentCatalogItem> {
  const db = getDb();
  const [updated] = await db
    .update(entertainmentCatalog)
    .set({ kind, title: title.trim(), detail })
    .where(eq(entertainmentCatalog.id, id))
    .returning(ENTERTAINMENT_CATALOG_COLUMNS);
  return updated;
}

export type EntertainmentUsage = { dates: string[] };

// entertainmentEntries.entertainmentId is onDelete: "restrict" — a logged
// day is the only way this catalog gets used, so this is the whole check.
export async function getEntertainmentUsage(id: number): Promise<EntertainmentUsage> {
  const db = getDb();
  const rows = await db
    .select({ date: entertainmentEntries.date })
    .from(entertainmentEntries)
    .where(eq(entertainmentEntries.entertainmentId, id))
    .orderBy(asc(entertainmentEntries.date));
  return { dates: [...new Set(rows.map((r) => r.date))] };
}

export async function deleteEntertainmentCatalogEntry(id: number): Promise<void> {
  const db = getDb();
  await db.delete(entertainmentCatalog).where(eq(entertainmentCatalog.id, id));
}

const EXERCISE_COLUMNS = { id: exercises.id, name: exercises.name, category: exercises.category };

export async function listExercisesCatalog(): Promise<ExerciseCatalogItem[]> {
  const db = getDb();
  return db.select(EXERCISE_COLUMNS).from(exercises).orderBy(asc(exercises.name));
}

export async function createExerciseCatalogEntry(
  name: string,
  category: ExerciseCategory
): Promise<ExerciseCatalogItem> {
  const db = getDb();
  const trimmed = name.trim();
  const [inserted] = await db
    .insert(exercises)
    .values({ name: trimmed, category })
    .onConflictDoNothing({ target: exercises.name })
    .returning(EXERCISE_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db.select(EXERCISE_COLUMNS).from(exercises).where(eq(exercises.name, trimmed));
  return existing;
}

export async function getExerciseCatalogEntry(id: number): Promise<ExerciseCatalogItem | null> {
  const db = getDb();
  const [row] = await db.select(EXERCISE_COLUMNS).from(exercises).where(eq(exercises.id, id));
  return row ?? null;
}

export async function updateExerciseCatalogEntry(
  id: number,
  name: string,
  category: ExerciseCategory
): Promise<ExerciseCatalogItem> {
  const db = getDb();
  const [updated] = await db
    .update(exercises)
    .set({ name: name.trim(), category })
    .where(eq(exercises.id, id))
    .returning(EXERCISE_COLUMNS);
  return updated;
}

export type ExerciseUsage = { dates: string[] };

// workouts.exerciseId is onDelete: "restrict".
export async function getExerciseUsage(id: number): Promise<ExerciseUsage> {
  const db = getDb();
  const rows = await db
    .select({ date: workouts.date })
    .from(workouts)
    .where(eq(workouts.exerciseId, id))
    .orderBy(asc(workouts.date));
  return { dates: [...new Set(rows.map((r) => r.date))] };
}

export async function deleteExerciseCatalogEntry(id: number): Promise<void> {
  const db = getDb();
  await db.delete(exercises).where(eq(exercises.id, id));
}

// Workout locations are the `places` catalog above (listPlacesCatalog/
// createPlaceCatalogEntry) — see the comment above the `exercises` table in
// schema.ts for why there's no separate exercise-locations catalog here.

const MOVIE_COLUMNS = {
  id: movies.id,
  tmdbId: movies.tmdbId,
  title: movies.title,
  releaseDate: movies.releaseDate,
  runtimeMinutes: movies.runtimeMinutes,
  posterPath: movies.posterPath,
  genres: movies.genres,
  collectionName: movies.collectionName,
};

export async function listMoviesCatalog(): Promise<MovieCatalogItem[]> {
  const db = getDb();
  return db.select(MOVIE_COLUMNS).from(movies).orderBy(asc(movies.title));
}

// Upsert-by-tmdbId, same "typing/picking something that already exists just
// selects the existing row" reasoning as the catalogs above — here it's
// picking the same TMDB search result twice (e.g. a rewatch) rather than a
// retyped name, but the effect is the same: no duplicate row, no error.
export async function createMovieCatalogEntry(input: {
  tmdbId: number;
  title: string;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  posterPath: string | null;
  genres: string[];
  collectionName: string | null;
}): Promise<MovieCatalogItem> {
  const db = getDb();
  const [inserted] = await db
    .insert(movies)
    .values(input)
    .onConflictDoNothing({ target: movies.tmdbId })
    .returning(MOVIE_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db.select(MOVIE_COLUMNS).from(movies).where(eq(movies.tmdbId, input.tmdbId));
  return existing;
}

export async function getMovieCatalogEntry(id: number): Promise<MovieCatalogItem | null> {
  const db = getDb();
  const [row] = await db.select(MOVIE_COLUMNS).from(movies).where(eq(movies.id, id));
  return row ?? null;
}

// Movies have no hand-editable fields — every field is TMDB metadata,
// refreshed by re-fetching rather than typed in (see src/lib/tmdb.ts) — so
// there's no updateMovieCatalogEntry here, unlike every other catalog.
// "Manage" for a movie is really just: see its watch history, delete it if
// it was added by mistake.
export type MovieUsage = {
  watches: { date: string; rating: number | null; locationType: string | null }[];
};

// movie_watches.movieId is onDelete: "restrict" (movie_watchlist/
// movie_rankings both cascade instead, but neither has any UI yet — see
// REBUILD_PLAN.md — so watches are the only usage worth surfacing).
export async function getMovieUsage(id: number): Promise<MovieUsage> {
  const db = getDb();
  const rows = await db
    .select({ date: movieWatches.date, rating: movieWatches.rating, locationType: movieWatches.locationType })
    .from(movieWatches)
    .where(eq(movieWatches.movieId, id))
    .orderBy(asc(movieWatches.date));
  return { watches: rows };
}

export async function deleteMovieCatalogEntry(id: number): Promise<void> {
  const db = getDb();
  await db.delete(movies).where(eq(movies.id, id));
}

// --- TV shows ------------------------------------------------------------
// Same TMDB-sourced-catalog shape as movies, plus two fields that are
// genuinely user state rather than TMDB metadata: `interested` (still
// tracking this show, or done with it — legacy's un/interested toggle) and
// `lastRefreshed` (a show's status/next-episode date go stale in a way a
// movie's fields never do, so there's a manual "Refresh from TMDB" action,
// unlike movies). No episode-watch tracking here yet — that's a separate,
// larger feature (see REBUILD_PLAN.md); this is catalog management only.

const TV_SHOW_COLUMNS = {
  id: tvShows.id,
  tmdbId: tvShows.tmdbId,
  title: tvShows.title,
  posterPath: tvShows.posterPath,
  genres: tvShows.genres,
  status: tvShows.status,
  interested: tvShows.interested,
  uninterestedDate: tvShows.uninterestedDate,
  lastRefreshed: tvShows.lastRefreshed,
  nextEpisodeDate: tvShows.nextEpisodeDate,
  nextEpisodeSeason: tvShows.nextEpisodeSeason,
  nextEpisodeNumber: tvShows.nextEpisodeNumber,
};

export type TvShowCatalogItem = {
  id: number;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  genres: string[];
  status: string | null;
  interested: boolean;
  uninterestedDate: string | null;
  lastRefreshed: string | null;
  nextEpisodeDate: string | null;
  nextEpisodeSeason: number | null;
  nextEpisodeNumber: number | null;
};

type TvShowTmdbFields = {
  tmdbId: number;
  title: string;
  posterPath: string | null;
  genres: string[];
  status: string | null;
  nextEpisodeDate: string | null;
  nextEpisodeSeason: number | null;
  nextEpisodeNumber: number | null;
};

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function listTvShowsCatalog(): Promise<TvShowCatalogItem[]> {
  const db = getDb();
  return db.select(TV_SHOW_COLUMNS).from(tvShows).orderBy(asc(tvShows.title));
}

// Upsert-by-tmdbId, same reasoning as movies — picking the same TMDB search
// result twice just returns the existing row.
export async function createTvShowCatalogEntry(input: TvShowTmdbFields): Promise<TvShowCatalogItem> {
  const db = getDb();
  const [inserted] = await db
    .insert(tvShows)
    .values({ ...input, interested: true, lastRefreshed: todayDateString() })
    .onConflictDoNothing({ target: tvShows.tmdbId })
    .returning(TV_SHOW_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db.select(TV_SHOW_COLUMNS).from(tvShows).where(eq(tvShows.tmdbId, input.tmdbId));
  return existing;
}

export async function getTvShowCatalogEntry(id: number): Promise<TvShowCatalogItem | null> {
  const db = getDb();
  const [row] = await db.select(TV_SHOW_COLUMNS).from(tvShows).where(eq(tvShows.id, id));
  return row ?? null;
}

// The one hand-editable field: are you still tracking this show. Marking
// not-interested stamps today's date (matching the legacy app's
// uninterested_date); marking interested again clears it.
export async function updateTvShowInterested(id: number, interested: boolean): Promise<TvShowCatalogItem> {
  const db = getDb();
  const [updated] = await db
    .update(tvShows)
    .set({ interested, uninterestedDate: interested ? null : todayDateString() })
    .where(eq(tvShows.id, id))
    .returning(TV_SHOW_COLUMNS);
  return updated;
}

// Re-fetches everything TMDB-sourced (status, next episode, poster, genres,
// title) without touching `interested`/`uninterestedDate` — those are the
// user's own state, a refresh shouldn't clobber them.
export async function refreshTvShowCatalogEntry(id: number, input: TvShowTmdbFields): Promise<TvShowCatalogItem> {
  const db = getDb();
  const [updated] = await db
    .update(tvShows)
    .set({
      title: input.title,
      posterPath: input.posterPath,
      genres: input.genres,
      status: input.status,
      nextEpisodeDate: input.nextEpisodeDate,
      nextEpisodeSeason: input.nextEpisodeSeason,
      nextEpisodeNumber: input.nextEpisodeNumber,
      lastRefreshed: todayDateString(),
    })
    .where(eq(tvShows.id, id))
    .returning(TV_SHOW_COLUMNS);
  return updated;
}

export type TvShowUsage = { watchCount: number };

// tv_episode_watches.episodeId is onDelete: "restrict", and tv_episodes.
// showId is onDelete: "cascade" from tvShows — so deleting a show with any
// watched episode is blocked transitively by the deeper restrict, exactly
// like movies. No episode-tracking UI exists yet, so this can only ever be
// 0 today, but the check (and the DB constraint it mirrors) is already
// correct for when it lands.
export async function getTvShowUsage(id: number): Promise<TvShowUsage> {
  const db = getDb();
  const [row] = await db
    .select({ count: tvEpisodeWatches.id })
    .from(tvEpisodeWatches)
    .innerJoin(tvEpisodes, eq(tvEpisodeWatches.episodeId, tvEpisodes.id))
    .where(eq(tvEpisodes.showId, id));
  return { watchCount: row ? 1 : 0 };
}

export async function deleteTvShowCatalogEntry(id: number): Promise<void> {
  const db = getDb();
  await db.delete(tvShows).where(eq(tvShows.id, id));
}

// Same shape as validateMovieCatalogRequest — a new show is added by tmdbId
// only, never by hand-typed fields.
export function validateTvShowCatalogRequest(body: unknown): Result<{ tmdbId: number }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const tmdbId = typeof b.tmdbId === "number" ? b.tmdbId : NaN;
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return { ok: false, error: "Invalid tmdbId" };
  }
  return { ok: true, value: { tmdbId } };
}

// --- Sports ----------------------------------------------------------------
// A fully manual sport -> league -> team hierarchy, no external API — the
// legacy survey found this the one entertainment domain that was genuinely
// complete and well-used, so it's ported closely rather than rebuilt (see
// the schema.ts comment above `sports`). Delete behavior follows the real
// FK policies rather than a single blanket rule: sportsLeagues.sportId and
// sportsTeams.sportId are onDelete: "cascade" (deleting a sport quietly
// takes its leagues/teams with it), while sportsTeams.leagueId and every FK
// on sportsWatches except sportId itself are onDelete: "set null" —
// sportsWatches.sportId is the only one that's "restrict". Usage checks
// below distinguish real blocks from purely informational counts to match.

const SPORT_COLUMNS = { id: sports.id, name: sports.name, isTeamSport: sports.isTeamSport };

export function validateSportInput(body: unknown): Result<{ name: string; isTeamSport: boolean }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  const isTeamSport = b.isTeamSport !== false; // defaults true, matching the schema default
  return { ok: true, value: { name, isTeamSport } };
}

// Each sport comes back with its leagues and teams nested — populates both
// the manage hub and the entry form's sport -> league -> team picker
// cascade in one round trip, same "nest the children" shape as
// listPlaceCategories/listExerciseFocuses in catalog-admin.ts.
export async function listSportsCatalog(): Promise<
  (SportCatalogItem & { leagues: SportsLeagueItem[]; teams: SportsTeamItem[] })[]
> {
  const db = getDb();
  const [sportRows, leagueRows, teamRows] = await Promise.all([
    db.select(SPORT_COLUMNS).from(sports).orderBy(asc(sports.name)),
    db.select().from(sportsLeagues).orderBy(asc(sportsLeagues.name)),
    db.select().from(sportsTeams).orderBy(asc(sportsTeams.name)),
  ]);
  const leaguesBySport = new Map<number, SportsLeagueItem[]>();
  for (const l of leagueRows) {
    const list = leaguesBySport.get(l.sportId) ?? [];
    list.push(l);
    leaguesBySport.set(l.sportId, list);
  }
  const teamsBySport = new Map<number, SportsTeamItem[]>();
  for (const t of teamRows) {
    const list = teamsBySport.get(t.sportId) ?? [];
    list.push(t);
    teamsBySport.set(t.sportId, list);
  }
  return sportRows.map((s) => ({
    ...s,
    leagues: leaguesBySport.get(s.id) ?? [],
    teams: teamsBySport.get(s.id) ?? [],
  }));
}

export async function createSport(input: { name: string; isTeamSport: boolean }): Promise<SportCatalogItem> {
  const db = getDb();
  const trimmed = input.name.trim();
  const [inserted] = await db
    .insert(sports)
    .values({ name: trimmed, isTeamSport: input.isTeamSport })
    .onConflictDoNothing({ target: sports.name })
    .returning(SPORT_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db.select(SPORT_COLUMNS).from(sports).where(eq(sports.name, trimmed));
  return existing;
}

export async function getSport(id: number): Promise<SportCatalogItem | null> {
  const db = getDb();
  const [row] = await db.select(SPORT_COLUMNS).from(sports).where(eq(sports.id, id));
  return row ?? null;
}

export async function updateSport(
  id: number,
  input: { name: string; isTeamSport: boolean }
): Promise<SportCatalogItem> {
  const db = getDb();
  const [updated] = await db
    .update(sports)
    .set({ name: input.name.trim(), isTeamSport: input.isTeamSport })
    .where(eq(sports.id, id))
    .returning(SPORT_COLUMNS);
  return updated;
}

// Only watchCount is a real block — sportsWatches.sportId is onDelete:
// "restrict". leagueCount/teamCount are informational only: both
// sportsLeagues.sportId and sportsTeams.sportId are onDelete: "cascade", so
// the DB would happily delete a sport along with everything under it —
// surfaced here so a caller can warn "N leagues and M teams will also be
// deleted" before that silently happens, not to block it.
export type SportUsage = { watchCount: number; leagueCount: number; teamCount: number };

export async function getSportUsage(id: number): Promise<SportUsage> {
  const db = getDb();
  const [watchRows, leagueRows, teamRows] = await Promise.all([
    db.select({ id: sportsWatches.id }).from(sportsWatches).where(eq(sportsWatches.sportId, id)),
    db.select({ id: sportsLeagues.id }).from(sportsLeagues).where(eq(sportsLeagues.sportId, id)),
    db.select({ id: sportsTeams.id }).from(sportsTeams).where(eq(sportsTeams.sportId, id)),
  ]);
  return { watchCount: watchRows.length, leagueCount: leagueRows.length, teamCount: teamRows.length };
}

export async function deleteSport(id: number): Promise<void> {
  const db = getDb();
  await db.delete(sports).where(eq(sports.id, id));
}

export function validateSportsLeagueInput(body: unknown): Result<{ name: string; type: string | null }> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  const type = typeof b.type === "string" && b.type.trim() ? b.type.trim() : null;
  return { ok: true, value: { name, type } };
}

export async function createSportsLeague(
  sportId: number,
  input: { name: string; type: string | null }
): Promise<SportsLeagueItem> {
  const db = getDb();
  const trimmed = input.name.trim();
  const [inserted] = await db
    .insert(sportsLeagues)
    .values({ sportId, name: trimmed, type: input.type })
    .onConflictDoNothing({ target: [sportsLeagues.sportId, sportsLeagues.name] })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(sportsLeagues)
    .where(and(eq(sportsLeagues.sportId, sportId), eq(sportsLeagues.name, trimmed)));
  return existing;
}

export async function getSportsLeague(id: number): Promise<SportsLeagueItem | null> {
  const db = getDb();
  const [row] = await db.select().from(sportsLeagues).where(eq(sportsLeagues.id, id));
  return row ?? null;
}

export async function updateSportsLeague(
  id: number,
  input: { name: string; type: string | null }
): Promise<SportsLeagueItem> {
  const db = getDb();
  const [updated] = await db
    .update(sportsLeagues)
    .set({ name: input.name.trim(), type: input.type })
    .where(eq(sportsLeagues.id, id))
    .returning();
  return updated;
}

// Neither count blocks — sportsTeams.leagueId and sportsWatches.leagueId
// are both onDelete: "set null", so the DB lets a league delete through
// regardless of either; purely informational, same "explain the fallout
// first" reasoning as sport's leagueCount/teamCount above.
export type SportsLeagueUsage = { teamCount: number; watchCount: number };

export async function getSportsLeagueUsage(id: number): Promise<SportsLeagueUsage> {
  const db = getDb();
  const [teamRows, watchRows] = await Promise.all([
    db.select({ id: sportsTeams.id }).from(sportsTeams).where(eq(sportsTeams.leagueId, id)),
    db.select({ id: sportsWatches.id }).from(sportsWatches).where(eq(sportsWatches.leagueId, id)),
  ]);
  return { teamCount: teamRows.length, watchCount: watchRows.length };
}

export async function deleteSportsLeague(id: number): Promise<void> {
  const db = getDb();
  await db.delete(sportsLeagues).where(eq(sportsLeagues.id, id));
}

export type SportsTeamInput = {
  leagueId: number | null;
  name: string;
  alias: string | null;
  homeLocation: string | null;
  color: string | null;
  division: string | null;
};

export function validateSportsTeamInput(body: unknown): Result<SportsTeamInput> {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid request body" };
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Name is required" };
  const leagueId = optionalIntId(b.leagueId);
  if (leagueId === INVALID_ID) return { ok: false, error: "Invalid league selection" };
  const alias = typeof b.alias === "string" && b.alias.trim() ? b.alias.trim() : null;
  const homeLocation = typeof b.homeLocation === "string" && b.homeLocation.trim() ? b.homeLocation.trim() : null;
  const color = typeof b.color === "string" && b.color.trim() ? b.color.trim() : null;
  const division = typeof b.division === "string" && b.division.trim() ? b.division.trim() : null;
  return { ok: true, value: { leagueId, name, alias, homeLocation, color, division } };
}

export async function createSportsTeam(sportId: number, input: SportsTeamInput): Promise<SportsTeamItem> {
  const db = getDb();
  const trimmed = input.name.trim();
  const [inserted] = await db
    .insert(sportsTeams)
    .values({
      sportId,
      leagueId: input.leagueId,
      name: trimmed,
      alias: input.alias,
      homeLocation: input.homeLocation,
      color: input.color,
      division: input.division,
    })
    .onConflictDoNothing({ target: [sportsTeams.sportId, sportsTeams.name] })
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(sportsTeams)
    .where(and(eq(sportsTeams.sportId, sportId), eq(sportsTeams.name, trimmed)));
  return existing;
}

export async function getSportsTeam(id: number): Promise<SportsTeamItem | null> {
  const db = getDb();
  const [row] = await db.select().from(sportsTeams).where(eq(sportsTeams.id, id));
  return row ?? null;
}

export async function updateSportsTeam(id: number, input: SportsTeamInput): Promise<SportsTeamItem> {
  const db = getDb();
  const [updated] = await db
    .update(sportsTeams)
    .set({
      leagueId: input.leagueId,
      name: input.name.trim(),
      alias: input.alias,
      homeLocation: input.homeLocation,
      color: input.color,
      division: input.division,
    })
    .where(eq(sportsTeams.id, id))
    .returning();
  return updated;
}

// Never blocks — sportsWatches.homeTeamId/awayTeamId are both onDelete:
// "set null" — purely informational, same reasoning as league usage above.
export type SportsTeamUsage = { watchCount: number };

export async function getSportsTeamUsage(id: number): Promise<SportsTeamUsage> {
  const db = getDb();
  const rows = await db
    .select({ id: sportsWatches.id })
    .from(sportsWatches)
    .where(or(eq(sportsWatches.homeTeamId, id), eq(sportsWatches.awayTeamId, id)));
  return { watchCount: rows.length };
}

export async function deleteSportsTeam(id: number): Promise<void> {
  const db = getDb();
  await db.delete(sportsTeams).where(eq(sportsTeams.id, id));
}

// --- Books -------------------------------------------------------------
// Same TMDB-sourced-catalog shape as movies (upsert by external id, no
// hand-editable fields), just sourced from Google Books instead — see
// src/lib/google-books.ts. No "interested" toggle like tvShows (a book
// isn't "ongoing" the way a show is); reading progress is computed on read
// rather than stored, per the schema.ts comment above `books`.

const BOOK_COLUMNS = {
  id: books.id,
  googleBooksId: books.googleBooksId,
  title: books.title,
  authors: books.authors,
  publisher: books.publisher,
  publishedDate: books.publishedDate,
  description: books.description,
  thumbnailUrl: books.thumbnailUrl,
  pageCount: books.pageCount,
  categories: books.categories,
};

export async function listBooksCatalog(): Promise<BookCatalogItem[]> {
  const db = getDb();
  return db.select(BOOK_COLUMNS).from(books).orderBy(asc(books.title));
}

// Upsert-by-googleBooksId, same reasoning as movies — picking the same
// Google Books search result twice (e.g. starting a reread) just returns
// the existing row.
export async function createBookCatalogEntry(input: {
  googleBooksId: string;
  title: string;
  authors: string[];
  publisher: string | null;
  publishedDate: string | null;
  description: string | null;
  thumbnailUrl: string | null;
  pageCount: number | null;
  categories: string[];
}): Promise<BookCatalogItem> {
  const db = getDb();
  const [inserted] = await db
    .insert(books)
    .values(input)
    .onConflictDoNothing({ target: books.googleBooksId })
    .returning(BOOK_COLUMNS);
  if (inserted) return inserted;
  const [existing] = await db.select(BOOK_COLUMNS).from(books).where(eq(books.googleBooksId, input.googleBooksId));
  return existing;
}

export async function getBookCatalogEntry(id: number): Promise<BookCatalogItem | null> {
  const db = getDb();
  const [row] = await db.select(BOOK_COLUMNS).from(books).where(eq(books.id, id));
  return row ?? null;
}

// Books have no hand-editable fields — every field is Google Books
// metadata, refreshed by re-adding rather than typed in (see
// src/lib/google-books.ts) — so there's no updateBookCatalogEntry here,
// same as movies.
export type BookUsage = {
  sessions: {
    date: string;
    startPage: number | null;
    endPage: number | null;
    completed: boolean;
    locationType: string | null;
  }[];
};

// book_reading_sessions.bookId is onDelete: "restrict" (book_watchlist/
// book_rankings both cascade instead, but neither has any UI yet — same
// "not worth surfacing" call as movie_watchlist/movie_rankings above — so
// sessions are the only usage worth checking).
export async function getBookUsage(id: number): Promise<BookUsage> {
  const db = getDb();
  const rows = await db
    .select({
      date: bookReadingSessions.date,
      startPage: bookReadingSessions.startPage,
      endPage: bookReadingSessions.endPage,
      completed: bookReadingSessions.completed,
      locationType: bookReadingSessions.locationType,
    })
    .from(bookReadingSessions)
    .where(eq(bookReadingSessions.bookId, id))
    .orderBy(asc(bookReadingSessions.date), asc(bookReadingSessions.id));
  return { sessions: rows };
}

export async function deleteBookCatalogEntry(id: number): Promise<void> {
  const db = getDb();
  await db.delete(books).where(eq(books.id, id));
}

export type BookProgress = { currentPage: number | null; completions: number };

// Computed on read rather than stored — see the schema.ts comment above
// `books`. `completions` is a plain count of completed sessions.
// `currentPage` is the last logged `endPage` among sessions *since* the
// most recent completion (so finishing a book and starting it over resets
// the visible progress instead of showing the old ending page forever);
// if the book has never been completed, every session counts.
export async function getBookProgress(bookId: number): Promise<BookProgress> {
  const db = getDb();
  const rows = await db
    .select({
      endPage: bookReadingSessions.endPage,
      completed: bookReadingSessions.completed,
    })
    .from(bookReadingSessions)
    .where(eq(bookReadingSessions.bookId, bookId))
    .orderBy(asc(bookReadingSessions.date), asc(bookReadingSessions.id));

  const completions = rows.filter((r) => r.completed).length;

  let lastCompletedIndex = -1;
  rows.forEach((r, i) => {
    if (r.completed) lastCompletedIndex = i;
  });

  let currentPage: number | null = null;
  for (const r of rows.slice(lastCompletedIndex + 1)) {
    if (r.endPage !== null) currentPage = r.endPage;
  }

  return { currentPage, completions };
}
