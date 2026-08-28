import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { TagsManageList } from "@/components/manage/tags-manage-list";
import { listTags } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageTagsPage() {
  const tags = await listTags();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Tags</h1>
        <Link href="/manage/people" className={buttonVariants({ variant: "outline", size: "sm" })}>
          People
        </Link>
      </div>
      <TagsManageList initial={tags} />
    </main>
  );
}
