import { notFound } from "next/navigation";
import { GameCategoryDetail } from "@/components/manage/game-category-detail";
import { getGameCategory, getGameCategoryUsage, getGameSubcategoryUsage, listGameCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageGameCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const category = await getGameCategory(id);
  if (!category) {
    notFound();
    return;
  }
  const [usage, allCategories] = await Promise.all([getGameCategoryUsage(id), listGameCategories()]);
  const subcategoryList = allCategories.find((c) => c.id === id)?.subcategories ?? [];
  const subcategories = await Promise.all(
    subcategoryList.map(async (s) => ({ ...s, usage: await getGameSubcategoryUsage(s.id) }))
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <GameCategoryDetail category={category} usage={usage} subcategories={subcategories} />
    </main>
  );
}
