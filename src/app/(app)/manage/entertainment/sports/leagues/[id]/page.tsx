import { notFound } from "next/navigation";
import { SportsLeagueDetail } from "@/components/manage/sports-league-detail";
import { getSport, getSportsLeague, getSportsLeagueUsage } from "@/lib/days";
import {
  getSportsDivisionUsage,
  getSportsSeasonUsage,
  listSportsDivisionsByLeague,
  listSportsSeasonsByLeague,
} from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function SportsLeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const league = await getSportsLeague(id);
  if (!league) {
    notFound();
    return;
  }

  const [sport, usage, seasonList, divisionList] = await Promise.all([
    getSport(league.sportId),
    getSportsLeagueUsage(id),
    listSportsSeasonsByLeague(id),
    listSportsDivisionsByLeague(id),
  ]);
  if (!sport) {
    notFound();
    return;
  }
  const seasons = await Promise.all(seasonList.map(async (s) => ({ ...s, usage: await getSportsSeasonUsage(s.id) })));
  const divisions = await Promise.all(
    divisionList.map(async (d) => ({ ...d, usage: await getSportsDivisionUsage(d.id) }))
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <SportsLeagueDetail sport={sport} league={league} usage={usage} seasons={seasons} divisions={divisions} />
    </main>
  );
}
