import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { EntertainmentDayForm } from "@/components/entry-forms/entertainment-day-form";
import { isValidDateString } from "@/lib/date";
import {
  listBooksCatalog,
  listEntertainmentCatalog,
  listGamesCatalog,
  listMoviesCatalog,
  listSportsCatalog,
  listTvShowsCatalog,
  loadDay,
} from "@/lib/days";
import {
  listEntertainmentKinds,
  listEntertainmentLocationTypes,
  listGameCategories,
  listGameDevices,
  listSportsGameTypes,
  listSportsSeasonsByLeague,
} from "@/lib/catalog-admin";
import type { SportsSeasonItem } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function EntertainmentEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const [
    day,
    movieCatalog,
    tvCatalog,
    sportsCatalog,
    bookCatalog,
    gamesCatalog,
    gameCategories,
    gameDevices,
    entertainmentCatalog,
    entertainmentKinds,
    locationTypes,
    sportsGameTypes,
  ] = await Promise.all([
    loadDay(date),
    listMoviesCatalog(),
    listTvShowsCatalog(),
    listSportsCatalog(),
    listBooksCatalog(),
    listGamesCatalog(),
    listGameCategories(),
    listGameDevices(),
    listEntertainmentCatalog(),
    listEntertainmentKinds(),
    listEntertainmentLocationTypes(),
    listSportsGameTypes(),
  ]);

  const leagueIds = sportsCatalog.flatMap((sport) => sport.leagues.map((l) => l.id));
  const seasonLists = await Promise.all(leagueIds.map((id) => listSportsSeasonsByLeague(id)));
  const sportsSeasonsByLeague: Record<number, SportsSeasonItem[]> = {};
  leagueIds.forEach((id, i) => {
    sportsSeasonsByLeague[id] = seasonLists[i];
  });

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="entertainment" />
      <EntertainmentDayForm
        date={date}
        initial={day}
        movieCatalog={movieCatalog}
        tvCatalog={tvCatalog}
        sportsCatalog={sportsCatalog}
        bookCatalog={bookCatalog}
        gamesCatalog={gamesCatalog}
        gameCategories={gameCategories}
        gameDevices={gameDevices}
        entertainmentCatalog={entertainmentCatalog}
        entertainmentKinds={entertainmentKinds}
        locationTypes={locationTypes}
        sportsGameTypes={sportsGameTypes}
        sportsSeasonsByLeague={sportsSeasonsByLeague}
      />
    </main>
  );
}
