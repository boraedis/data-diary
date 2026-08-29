import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { TvShowsManageList } from "@/components/manage/tvshows-manage-list";
import { listTvShowsCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageTvShowsPage() {
  const shows = await listTvShowsCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">TV shows</h1>
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Entertainment
        </Link>
      </div>
      <TvShowsManageList initial={shows} />
    </main>
  );
}
