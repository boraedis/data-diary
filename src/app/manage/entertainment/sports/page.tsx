import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SportsManageList } from "@/components/manage/sports-manage-list";
import { listSportsCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageSportsPage() {
  const sports = await listSportsCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Sports</h1>
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Entertainment
        </Link>
      </div>
      <SportsManageList initial={sports} />
    </main>
  );
}
