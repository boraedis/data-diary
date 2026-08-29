import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PlacesManageList } from "@/components/manage/places-manage-list";
import { listPlacesCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManagePlacesPage() {
  const places = await listPlacesCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Places</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage Home
        </Link>
      </div>
      <PlacesManageList initial={places} />
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
