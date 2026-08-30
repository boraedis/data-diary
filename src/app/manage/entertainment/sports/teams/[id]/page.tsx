import { notFound } from "next/navigation";
import { SportsTeamDetail } from "@/components/manage/sports-team-detail";
import { getSport, getSportsTeam, getSportsTeamUsage, listSportsCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function SportsTeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const team = await getSportsTeam(id);
  if (!team) {
    notFound();
    return;
  }

  const [sport, usage, catalog] = await Promise.all([
    getSport(team.sportId),
    getSportsTeamUsage(id),
    listSportsCatalog(),
  ]);
  if (!sport) {
    notFound();
    return;
  }
  const leagues = catalog.find((s) => s.id === team.sportId)?.leagues ?? [];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <SportsTeamDetail sport={sport} team={team} leagues={leagues} usage={usage} />
    </main>
  );
}
