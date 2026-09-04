import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PlaceWorldTree } from "@/components/manage/place-world-tree";
import { getPlaceMentionCounts, listPlacesCatalog } from "@/lib/days";
import { listPlaceCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function PlacesWorldPage() {
  const [places, categories, mentionCounts] = await Promise.all([
    listPlacesCatalog(),
    listPlaceCategories(),
    getPlaceMentionCounts(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">World</h1>
        <Link href="/manage/places" className={buttonVariants({ variant: "outline", size: "sm" })}>
          &larr; Places
        </Link>
      </div>
      <PlaceWorldTree initial={places} categories={categories} mentionCounts={mentionCounts} />
    </main>
  );
}
