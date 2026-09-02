import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PodcastCategoriesManageList } from "@/components/manage/podcast-categories-manage-list";
import { listPodcastCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManagePodcastCategoriesPage() {
  const categories = await listPodcastCategories();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Podcast categories</h1>
        <Link href="/manage/entertainment/music" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Music
        </Link>
      </div>
      <PodcastCategoriesManageList initial={categories} />
    </main>
  );
}
