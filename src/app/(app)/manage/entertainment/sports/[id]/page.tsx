import { notFound } from "next/navigation";
import { SportDetail } from "@/components/manage/sport-detail";
import { getSport, getSportUsage, listSportsCatalog } from "@/lib/days";
import { listSportsDivisionsByLeague } from "@/lib/catalog-admin";
import type { SportsDivisionItem } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function SportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const [sport, usage, catalog] = await Promise.all([getSport(id), getSportUsage(id), listSportsCatalog()]);
  if (!sport) {
    notFound();
    return;
  }

  const entry = catalog.find((s) => s.id === id);
  const leagues = entry?.leagues ?? [];
  const teams = entry?.teams ?? [];

  const leagueIds = leagues.map((l) => l.id);
  const divisionLists = await Promise.all(leagueIds.map((leagueId) => listSportsDivisionsByLeague(leagueId)));
  const divisionsByLeague: Record<number, SportsDivisionItem[]> = {};
  leagueIds.forEach((leagueId, i) => {
    divisionsByLeague[leagueId] = divisionLists[i];
  });

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-3xl md:gap-6 md:py-12">
      <SportDetail sport={sport} usage={usage} leagues={leagues} teams={teams} divisionsByLeague={divisionsByLeague} />
    </main>
  );
}
