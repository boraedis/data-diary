import { notFound } from "next/navigation";
import { SportsLeagueDetail } from "@/components/manage/sports-league-detail";
import { getSport, getSportsLeague, getSportsLeagueUsage } from "@/lib/days";

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

  const [sport, usage] = await Promise.all([getSport(league.sportId), getSportsLeagueUsage(id)]);
  if (!sport) {
    notFound();
    return;
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <SportsLeagueDetail sport={sport} league={league} usage={usage} />
    </main>
  );
}
