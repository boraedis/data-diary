import { notFound } from "next/navigation";
import { PodcastCategoryDetail } from "@/components/manage/podcast-category-detail";
import { getPodcastCategory, getPodcastCategoryUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManagePodcastCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const category = await getPodcastCategory(id);
  if (!category) {
    notFound();
    return;
  }
  const usage = await getPodcastCategoryUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <PodcastCategoryDetail category={category} usage={usage} />
    </main>
  );
}
