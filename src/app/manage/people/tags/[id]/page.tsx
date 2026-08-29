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
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <TagDetail tag={tag} usage={usage} />
    </main>
  );
}
