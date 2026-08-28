import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PlaceCategoriesManageList } from "@/components/manage/place-categories-manage-list";
import { listPlaceCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManagePlaceCategoriesPage() {
  const categories = await listPlaceCategories();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Place categories</h1>
        <Link href="/manage/places" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Places
        </Link>
      </div>
      <PlaceCategoriesManageList initial={categories} />
    </main>
  );
}
