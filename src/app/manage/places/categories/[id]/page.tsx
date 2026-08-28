import { notFound } from "next/navigation";
import { PlaceCategoryDetail } from "@/components/manage/place-category-detail";
import { getPlaceCategory, getPlaceCategoryUsage, getPlaceSubcategoryUsage, listPlaceCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManagePlaceCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const category = await getPlaceCategory(id);
  if (!category) {
    notFound();
    return;
  }
  const [usage, allCategories] = await Promise.all([getPlaceCategoryUsage(id), listPlaceCategories()]);
  const subcategoryList = allCategories.find((c) => c.id === id)?.subcategories ?? [];
  const subcategories = await Promise.all(
    subcategoryList.map(async (s) => ({ ...s, usage: await getPlaceSubcategoryUsage(s.id) }))
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <PlaceCategoryDetail category={category} usage={usage} subcategories={subcategories} />
    </main>
  );
}
