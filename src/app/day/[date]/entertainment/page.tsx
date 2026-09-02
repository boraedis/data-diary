import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { EntertainmentDayForm } from "@/components/entry-forms/entertainment-day-form";
import { isValidDateString } from "@/lib/date";
import {
  listBooksCatalog,
  listEntertainmentCatalog,
  listMoviesCatalog,
  listSportsCatalog,
  listTvShowsCatalog,
  loadDay,
} from "@/lib/days";
import { listEntertainmentKinds, listEntertainmentLocationTypes, listSportsGameTypes, listSportsSeasonsByLeague } from "@/lib/catalog-admin";
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

  const [day, movieCatalog, tvCatalog, sportsCatalog, bookCatalog, entertainmentCatalog, entertainmentKinds, locationTypes, sportsGameTypes] =
    await Promise.all([
      loadDay(date),
      listMoviesCatalog(),
      listTvShowsCatalog(),
      listSportsCatalog(),
      listBooksCatalog(),
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
        entertainmentCatalog={entertainmentCatalog}
        entertainmentKinds={entertainmentKinds}
        locationTypes={locationTypes}
        sportsGameTypes={sportsGameTypes}
        sportsSeasonsByLeague={sportsSeasonsByLeague}
      />
    </main>
  );
}
