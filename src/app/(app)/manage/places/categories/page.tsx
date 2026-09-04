import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PlaceCategoriesManageList } from "@/components/manage/place-categories-manage-list";
import { listPlaceCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManagePlaceCategoriesPage() {
  const categories = await listPlaceCategories();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Place categories</h1>
        <Link href="/manage/places" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Places
        </Link>
      </div>
      <PlaceCategoriesManageList initial={categories} />
    </main>
  );
}
