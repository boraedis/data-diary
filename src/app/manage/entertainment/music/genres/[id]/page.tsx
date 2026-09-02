import { notFound } from "next/navigation";
import { GenreDetail } from "@/components/manage/genre-detail";
import { getGenre, getGenreUsage, listGenreGroups } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageGenrePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const genre = await getGenre(id);
  if (!genre) {
    notFound();
    return;
  }
  const [usage, groups] = await Promise.all([getGenreUsage(id), listGenreGroups()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <GenreDetail genre={genre} groups={groups} usage={usage} />
    </main>
  );
}
