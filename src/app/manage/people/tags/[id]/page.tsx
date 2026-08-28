import { notFound } from "next/navigation";
import { TagDetail } from "@/components/manage/tag-detail";
import { getTag, getTagUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageTagPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const tag = await getTag(id);
  if (!tag) {
    notFound();
    return;
  }
  const usage = await getTagUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <TagDetail tag={tag} usage={usage} />
    </main>
  );
}
