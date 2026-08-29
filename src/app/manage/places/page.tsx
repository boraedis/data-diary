import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PlacesManageList } from "@/components/manage/places-manage-list";
import { getPlaceMentionCounts, listPlacesCatalog } from "@/lib/days";
import { listPlaceCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManagePlacesPage() {
  const [places, categories, mentionCounts] = await Promise.all([
    listPlacesCatalog(),
    listPlaceCategories(),
    getPlaceMentionCounts(),
  ]);

  // Most-mentioned first (own + every descendant's, see getPlaceMentionCounts
  // in src/lib/days.ts) rather than alphabetical — a name tiebreak keeps
  // unmentioned places in a stable, scannable order rather than DB order.
  const sortedPlaces = [...places].sort((a, b) => {
    const diff = (mentionCounts.get(b.id) ?? 0) - (mentionCounts.get(a.id) ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Places</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage Home
        </Link>
      </div>
      <PlacesManageList initial={sortedPlaces} categories={categories} />
      <div className="flex justify-end gap-2">
        <Link href="/manage/places/categories" className={buttonVariants({ variant: "outline", size: "xs" })}>
          Manage Categories
        </Link>
        <Link href="/manage/places/metros" className={buttonVariants({ variant: "outline", size: "xs" })}>
          Manage Metros
        </Link>
      </div>
    </main>
  );
}
