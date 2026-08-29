import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PeopleManageList } from "@/components/manage/people-manage-list";
import { listTags } from "@/lib/catalog-admin";
import { listPeopleCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManagePeoplePage() {
  const [people, tags] = await Promise.all([listPeopleCatalog(), listTags()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">People</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage Home
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
