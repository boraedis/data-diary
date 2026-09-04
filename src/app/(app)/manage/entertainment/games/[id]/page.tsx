import { notFound } from "next/navigation";
import { GameDetail } from "@/components/manage/game-detail";
import { getGameCatalogEntry, getGameUsage } from "@/lib/days";
import { listGameCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const game = await getGameCatalogEntry(id);
  if (!game) {
    notFound();
    return;
  }
  const [usage, categories] = await Promise.all([getGameUsage(id), listGameCategories()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <GameDetail game={game} usage={usage} categories={categories} />
    </main>
  );
}
