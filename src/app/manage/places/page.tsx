import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PlacesManageList } from "@/components/manage/places-manage-list";
import { listPlacesCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManagePlacesPage() {
  const places = await listPlacesCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Places</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage
        </Link>
      </div>
      <PlacesManageList initial={places} />
    </main>
  );
}
