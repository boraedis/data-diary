import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PeopleManageList } from "@/components/manage/people-manage-list";
import { listTags } from "@/lib/catalog-admin";
import { listPeopleCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManagePeoplePage() {
  const [people, tags] = await Promise.all([listPeopleCatalog(), listTags()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">People</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage
        </Link>
      </div>
      <div className="flex justify-end">
        <Link href="/manage/people/tags" className={buttonVariants({ variant: "outline", size: "xs" })}>
          Manage tags
        </Link>
      </div>
      <PeopleManageList initial={people} initialTags={tags} />
    </main>
  );
}
