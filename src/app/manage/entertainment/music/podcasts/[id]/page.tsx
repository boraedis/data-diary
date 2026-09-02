import { notFound } from "next/navigation";
import { PodcastShowDetail } from "@/components/manage/podcast-show-detail";
import { getPodcastShow, listPodcastCategories } from "@/lib/catalog-admin";
import { getPodcastShowEpisodes } from "@/lib/music";

export const dynamic = "force-dynamic";

export default async function ManagePodcastShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const show = await getPodcastShow(id);
  if (!show) {
    notFound();
    return;
  }
  const [episodes, categories] = await Promise.all([getPodcastShowEpisodes(id), listPodcastCategories()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <PodcastShowDetail show={show} categories={categories} episodes={episodes} />
    </main>
  );
}
