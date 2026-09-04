import { notFound } from "next/navigation";
import { SportsGameTypeDetail } from "@/components/manage/sports-game-type-detail";
import { getSportsGameType, getSportsGameTypeUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageSportsGameTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const gameType = await getSportsGameType(id);
  if (!gameType) {
    notFound();
    return;
  }
  const usage = await getSportsGameTypeUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <SportsGameTypeDetail gameType={gameType} usage={usage} />
    </main>
  );
}
