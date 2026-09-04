import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SportsManageList } from "@/components/manage/sports-manage-list";
import { listSportsCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageSportsPage() {
  const sports = await listSportsCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Sports</h1>
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Entertainment
        </Link>
      </div>
      <SportsManageList initial={sports} />
      <div className="flex justify-end">
        <Link
          href="/manage/entertainment/sports/game-types"
          className={buttonVariants({ variant: "outline", size: "xs" })}
        >
          Manage Game Types
        </Link>
      </div>
    </main>
  );
}
