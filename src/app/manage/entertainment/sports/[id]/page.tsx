import { notFound } from "next/navigation";
import { SportDetail } from "@/components/manage/sport-detail";
import {
  getSport,
  getSportsLeagueUsage,
  getSportsTeamUsage,
  getSportUsage,
  listSportsCatalog,
} from "@/lib/days";

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
  const leagueList = entry?.leagues ?? [];
  const teamList = entry?.teams ?? [];

  // Usage is fetched per league/team here (server-side, in parallel) so the
  // detail page can show an accurate "N teams/watches will be affected"
  // warning next to every row without a client-side waterfall of requests.
  const [leagueUsages, teamUsages] = await Promise.all([
    Promise.all(leagueList.map((l) => getSportsLeagueUsage(l.id))),
    Promise.all(teamList.map((t) => getSportsTeamUsage(t.id))),
  ]);

  const leagues = leagueList.map((l, i) => ({ ...l, usage: leagueUsages[i] }));
  const teams = teamList.map((t, i) => ({ ...t, usage: teamUsages[i] }));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <SportDetail sport={sport} usage={usage} leagues={leagues} teams={teams} />
    </main>
  );
}
