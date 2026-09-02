import { notFound } from "next/navigation";
import { GenreGroupDetail } from "@/components/manage/genre-group-detail";
import { getGenreGroup, getGenreGroupUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageGenreGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const group = await getGenreGroup(id);
  if (!group) {
    notFound();
    return;
  }
  const usage = await getGenreGroupUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <GenreGroupDetail group={group} usage={usage} />
    </main>
  );
}
