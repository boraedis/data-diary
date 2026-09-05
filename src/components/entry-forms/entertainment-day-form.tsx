"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchPanel, type SearchItem } from "@/components/entry-forms/search-panel";
import { MoviesSection, type MovieRow } from "@/components/entry-forms/movies-section";
import { TvSection, type TvEpisodeRow } from "@/components/entry-forms/tv-section";
import { SportsSection, type SportsCatalogEntry, type SportsRow } from "@/components/entry-forms/sports-section";
import { BooksSection, type BookRow } from "@/components/entry-forms/books-section";
import { GamesSection, type GameRow } from "@/components/entry-forms/games-section";
import { OtherEntertainmentSection, type OtherEntertainmentRow } from "@/components/entry-forms/other-entertainment-section";
import {
  decodeSearchId,
  encodeSearchId,
  entertainmentKindColor,
  ENTERTAINMENT_KIND_LABELS,
} from "@/lib/entertainment-search";
import type { PendingOpen } from "@/lib/use-pending-open";
import type {
  EntertainmentLocationTypeItem,
  EntertainmentKindItem,
  GameCategoryItem,
  GameDeviceTypeItem,
  GameSubcategoryItem,
  SportsDivisionItem,
  SportsGameTypeItem,
  SportsSeasonItem,
} from "@/lib/catalog-admin";
import type {
  BookCatalogItem,
  DayPayload,
  EntertainmentCatalogItem,
  GameCatalogItem,
  MovieCatalogItem,
  TvShowCatalogItem,
} from "@/lib/days";

/** The merged entertainment day-entry page (issue #61) — one unified search
 * across movies/TV/sports leagues/books/games/generic entertainment (games
 * added in issue #68), color-coded by kind, feeding whichever kind's own
 * detail modal via `pendingOpen` (search results carry a composite id — see
 * src/lib/entertainment-search.ts — decoded here and handed down as
 * `{kind, id, nonce}`; each section uses usePendingOpenMatch,
 * src/lib/use-pending-open.ts, to notice a match without an effect — nonce
 * increments on every select, even a reselect of the same item, so nothing
 * needs to explicitly clear pendingOpen back to null). Every kind keeps its
 * own local row state (same shape each old per-kind page/form owned
 * individually) but they now share one bottom Save button, firing all six
 * PATCHes at once. */
export function EntertainmentDayForm({
  date,
  initial,
  movieCatalog,
  tvCatalog,
  sportsCatalog,
  bookCatalog,
  gamesCatalog,
  gameCategories,
  gameDeviceTypes,
  entertainmentCatalog,
  entertainmentKinds,
  locationTypes: initialLocationTypes,
  sportsGameTypes,
  sportsSeasonsByLeague,
  sportsDivisionsByLeague,
}: {
  date: string;
  initial: DayPayload;
  movieCatalog: MovieCatalogItem[];
  tvCatalog: TvShowCatalogItem[];
  sportsCatalog: SportsCatalogEntry[];
  bookCatalog: BookCatalogItem[];
  gamesCatalog: GameCatalogItem[];
  gameCategories: (GameCategoryItem & { subcategories: GameSubcategoryItem[] })[];
  gameDeviceTypes: GameDeviceTypeItem[];
  entertainmentCatalog: EntertainmentCatalogItem[];
  entertainmentKinds: EntertainmentKindItem[];
  locationTypes: EntertainmentLocationTypeItem[];
  sportsGameTypes: SportsGameTypeItem[];
  sportsSeasonsByLeague: Record<number, SportsSeasonItem[]>;
  sportsDivisionsByLeague: Record<number, SportsDivisionItem[]>;
}) {
  const router = useRouter();

  // Shared across all 5 sections (issue #61 follow-up: entertainmentLocationTypes
  // is one catalog used by every kind, not a per-kind one) — lifted here so
  // adding a new location type from any section's own "+ New" flow is
  // immediately visible in every other section too, not just after a
  // page reload.
  const [locationTypes, setLocationTypes] = useState(initialLocationTypes);
  function handleLocationTypeCreated(item: EntertainmentLocationTypeItem) {
    setLocationTypes((prev) => (prev.some((t) => t.id === item.id) ? prev : [...prev, item].sort((a, b) => a.name.localeCompare(b.name))));
  }

  const [movieRows, setMovieRows] = useState<MovieRow[]>(
    initial.movies.map((w) => ({ movieId: w.movieId, rating: w.rating, locationType: w.locationType, durationMinutes: w.durationMinutes }))
  );
  const [tvRows, setTvRows] = useState<TvEpisodeRow[]>(
    initial.tvEpisodeWatches.map((w) => ({
      episodeId: w.episodeId,
      showTitle: w.showTitle,
      season: w.season,
      episode: w.episode,
      episodeName: w.episodeName,
      durationMinutes: w.durationMinutes,
      locationType: w.locationType,
    }))
  );
  const [sportsRows, setSportsRows] = useState<SportsRow[]>(
    initial.sportsWatches.map((w) => ({
      sportId: w.sportId,
      leagueId: w.leagueId,
      season: w.season,
      gameType: w.gameType,
      homeTeamId: w.homeTeamId,
      awayTeamId: w.awayTeamId,
      watchedLive: w.watchedLive,
      durationMinutes: w.durationMinutes,
      locationType: w.locationType,
    }))
  );
  const [bookRows, setBookRows] = useState<BookRow[]>(
    initial.bookSessions.map((s) => ({
      bookId: s.bookId,
      startPage: s.startPage,
      endPage: s.endPage,
      completed: s.completed,
      locationType: s.locationType,
      durationMinutes: s.durationMinutes,
    }))
  );
  const [otherRows, setOtherRows] = useState<OtherEntertainmentRow[]>(
    initial.entertainment.map((e) => ({ entertainmentId: e.entertainmentId, durationMinutes: e.durationMinutes, locationType: e.locationType }))
  );
  const [gameRows, setGameRows] = useState<GameRow[]>(
    initial.gameSessions.map((s) => ({ gameId: s.gameId, durationMinutes: s.durationMinutes, deviceType: s.deviceType, locationType: s.locationType }))
  );

  const [pendingOpen, setPendingOpen] = useState<PendingOpen>(null);
  const nonceRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const sportsLeagueItems = useMemo(
    () => sportsCatalog.flatMap((sport) => sport.leagues.map((league) => ({ league, sport }))),
    [sportsCatalog]
  );

  const searchItems: SearchItem[] = useMemo(() => {
    const movies: SearchItem[] = movieCatalog.map((m) => ({
      id: encodeSearchId("movie", m.id),
      primary: m.releaseDate ? `${m.title} - ${m.releaseDate.slice(0, 4)}` : m.title,
      secondary: ENTERTAINMENT_KIND_LABELS.movie,
      accentColor: entertainmentKindColor("movie"),
    }));
    const shows: SearchItem[] = tvCatalog.map((s) => ({
      id: encodeSearchId("tv", s.id),
      primary: s.title,
      secondary: ENTERTAINMENT_KIND_LABELS.tv,
      accentColor: entertainmentKindColor("tv"),
    }));
    const leagues: SearchItem[] = sportsLeagueItems.map(({ league, sport }) => ({
      id: encodeSearchId("sports", league.id),
      primary: league.name,
      secondary: ENTERTAINMENT_KIND_LABELS.sports,
      caption: sport.name,
      searchTerms: [sport.name],
      accentColor: entertainmentKindColor("sports"),
    }));
    const books: SearchItem[] = bookCatalog.map((b) => ({
      id: encodeSearchId("book", b.id),
      primary: b.authors.length > 0 ? `${b.title} - ${b.authors.join(", ")}` : b.title,
      secondary: ENTERTAINMENT_KIND_LABELS.book,
      accentColor: entertainmentKindColor("book"),
    }));
    const other: SearchItem[] = entertainmentCatalog.map((e) => ({
      id: encodeSearchId("other", e.id),
      primary: e.detail ? `${e.title} - ${e.detail}` : e.title,
      secondary: ENTERTAINMENT_KIND_LABELS.other,
      caption: e.kindName,
      accentColor: entertainmentKindColor("other"),
    }));
    const games: SearchItem[] = gamesCatalog.map((g) => ({
      id: encodeSearchId("game", g.id),
      primary: g.name,
      secondary: ENTERTAINMENT_KIND_LABELS.game,
      caption: [g.type, g.subtype].filter(Boolean).join(" · ") || null,
      accentColor: entertainmentKindColor("game"),
    }));
    return [...movies, ...shows, ...leagues, ...books, ...other, ...games];
  }, [movieCatalog, tvCatalog, sportsLeagueItems, bookCatalog, entertainmentCatalog, gamesCatalog]);

  function handleSearchSelect(compositeId: number) {
    nonceRef.current += 1;
    setPendingOpen({ ...decodeSearchId(compositeId), nonce: nonceRef.current });
  }

  // Sequential, not Promise.all — each PATCH replaces its own table for
  // this date and returns a fresh loadDay() snapshot; running them in
  // parallel would let an earlier response's snapshot race a later
  // request's still-in-flight write, so a table's rows could look stale in
  // the response used to resync local state. Running in order means the
  // final (game sessions, issue #68) response reflects all six tables'
  // just-saved state, since every prior write has already committed by the
  // time it runs — that response alone is enough to resync every section's
  // rows.
  async function handleSubmit() {
    setSaving(true);
    setError(null);

    try {
      const requests: [string, unknown][] = [
        [`/api/days/${date}/movies`, { entries: movieRows }],
        [
          `/api/days/${date}/tv-episode-watches`,
          { entries: tvRows.map(({ episodeId, durationMinutes, locationType }) => ({ episodeId, durationMinutes, locationType })) },
        ],
        [`/api/days/${date}/sports`, { entries: sportsRows }],
        [`/api/days/${date}/books`, { entries: bookRows }],
        [`/api/days/${date}/entertainment`, { entries: otherRows }],
        [`/api/days/${date}/game-sessions`, { entries: gameRows }],
      ];

      let saved: DayPayload | null = null;
      for (const [url, body] of requests) {
        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const parsed = await res.json();
        if (!res.ok) {
          setError(typeof parsed?.error === "string" ? parsed.error : "Failed to save");
          return;
        }
        saved = parsed as DayPayload;
      }
      if (!saved) return;

      setMovieRows(saved.movies.map((w) => ({ movieId: w.movieId, rating: w.rating, locationType: w.locationType, durationMinutes: w.durationMinutes })));
      setTvRows(
        saved.tvEpisodeWatches.map((w) => ({
          episodeId: w.episodeId,
          showTitle: w.showTitle,
          season: w.season,
          episode: w.episode,
          episodeName: w.episodeName,
          durationMinutes: w.durationMinutes,
          locationType: w.locationType,
        }))
      );
      setSportsRows(
        saved.sportsWatches.map((w) => ({
          sportId: w.sportId,
          leagueId: w.leagueId,
          season: w.season,
          gameType: w.gameType,
          homeTeamId: w.homeTeamId,
          awayTeamId: w.awayTeamId,
          watchedLive: w.watchedLive,
          durationMinutes: w.durationMinutes,
          locationType: w.locationType,
        }))
      );
      setBookRows(
        saved.bookSessions.map((s) => ({
          bookId: s.bookId,
          startPage: s.startPage,
          endPage: s.endPage,
          completed: s.completed,
          locationType: s.locationType,
          durationMinutes: s.durationMinutes,
        }))
      );
      setOtherRows(saved.entertainment.map((e) => ({ entertainmentId: e.entertainmentId, durationMinutes: e.durationMinutes, locationType: e.locationType })));
      setGameRows(
        saved.gameSessions.map((s) => ({ gameId: s.gameId, durationMinutes: s.durationMinutes, deviceType: s.deviceType, locationType: s.locationType }))
      );
      setSavedAt(Date.now());
      router.refresh();
    } catch {
      setError("Network error — could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-20">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Search entertainment</CardTitle>
        </CardHeader>
        <CardContent>
          <SearchPanel
            items={searchItems}
            onSelect={handleSearchSelect}
            placeholder="Search movies, TV shows, sports leagues, books…"
            emptyMessage={'No matches — use a section\'s own "+ New"/"+ Add" button below.'}
            autoFocus
          />
        </CardContent>
      </Card>

      <MoviesSection
        catalog={movieCatalog}
        locationTypes={locationTypes}
        onLocationTypeCreated={handleLocationTypeCreated}
        rows={movieRows}
        onRowsChange={setMovieRows}
        pendingOpen={pendingOpen}
      />

      <TvSection
        catalog={tvCatalog}
        locationTypes={locationTypes}
        onLocationTypeCreated={handleLocationTypeCreated}
        rows={tvRows}
        onRowsChange={setTvRows}
        pendingOpen={pendingOpen}
      />

      <SportsSection
        catalog={sportsCatalog}
        locationTypes={locationTypes}
        onLocationTypeCreated={handleLocationTypeCreated}
        gameTypes={sportsGameTypes}
        seasonsByLeague={sportsSeasonsByLeague}
        divisionsByLeague={sportsDivisionsByLeague}
        rows={sportsRows}
        onRowsChange={setSportsRows}
        pendingOpen={pendingOpen}
      />

      <BooksSection
        catalog={bookCatalog}
        locationTypes={locationTypes}
        onLocationTypeCreated={handleLocationTypeCreated}
        rows={bookRows}
        onRowsChange={setBookRows}
        pendingOpen={pendingOpen}
      />

      <GamesSection
        catalog={gamesCatalog}
        categories={gameCategories}
        deviceTypes={gameDeviceTypes}
        locationTypes={locationTypes}
        onLocationTypeCreated={handleLocationTypeCreated}
        rows={gameRows}
        onRowsChange={setGameRows}
        pendingOpen={pendingOpen}
      />

      <OtherEntertainmentSection
        catalog={entertainmentCatalog}
        kinds={entertainmentKinds}
        locationTypes={locationTypes}
        onLocationTypeCreated={handleLocationTypeCreated}
        rows={otherRows}
        onRowsChange={setOtherRows}
        pendingOpen={pendingOpen}
      />

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3 md:max-w-2xl">
          <span className="text-sm">
            {error ? (
              <span className="text-destructive">{error}</span>
            ) : savedAt ? (
              <span className="text-muted-foreground">Saved.</span>
            ) : null}
          </span>
          <Button type="button" onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
