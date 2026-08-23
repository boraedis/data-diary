import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EntertainmentManageList } from "@/components/manage/entertainment-manage-list";
import { listEntertainmentCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageEntertainmentPage() {
  const items = await listEntertainmentCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Entertainment</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage
        </Link>
      </div>
      <EntertainmentManageList initial={items} />
    </main>
  );
}
