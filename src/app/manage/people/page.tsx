import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PeopleManageList } from "@/components/manage/people-manage-list";
import { listPeopleCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManagePeoplePage() {
  const people = await listPeopleCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">People</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage
        </Link>
      </div>
      <PeopleManageList initial={people} />
    </main>
  );
}
