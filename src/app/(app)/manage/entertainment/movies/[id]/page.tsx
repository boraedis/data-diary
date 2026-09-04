import { notFound } from "next/navigation";
import { MovieDetail } from "@/components/manage/movie-detail";
import { getMovieCatalogEntry, getMovieUsage } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageMoviePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const movie = await getMovieCatalogEntry(id);
  if (!movie) {
    notFound();
    return;
  }
  const usage = await getMovieUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <MovieDetail movie={movie} usage={usage} />
    </main>
  );
}
