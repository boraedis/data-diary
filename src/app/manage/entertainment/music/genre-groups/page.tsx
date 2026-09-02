import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { GenreGroupsManageList } from "@/components/manage/genre-groups-manage-list";
import { listGenreGroups } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageGenreGroupsPage() {
  const groups = await listGenreGroups();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Genre groups</h1>
        <Link href="/manage/entertainment/music" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to Music
        </Link>
      </div>
      <GenreGroupsManageList initial={groups} />
    </main>
  );
}
