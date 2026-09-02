import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { GamesManageList } from "@/components/manage/games-manage-list";
import { listGamesCatalog } from "@/lib/days";
import { listGameCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageGamesPage() {
  const [games, categories] = await Promise.all([listGamesCatalog(), listGameCategories()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Games</h1>
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Entertainment
        </Link>
      </div>
      <GamesManageList initial={games} categories={categories} />
      <div className="flex justify-end gap-2">
        <Link href="/manage/entertainment/games/categories" className={buttonVariants({ variant: "outline", size: "xs" })}>
          Manage Categories
        </Link>
        <Link href="/manage/entertainment/games/devices" className={buttonVariants({ variant: "outline", size: "xs" })}>
          Manage Devices
        </Link>
      </div>
    </main>
  );
}
