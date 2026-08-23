import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { MovieEntryForm } from "@/components/entry-forms/movie-entry-form";
import { isValidDateString } from "@/lib/date";
import { listMoviesCatalog, loadDay } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function MoviesEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const [day, catalog] = await Promise.all([loadDay(date), listMoviesCatalog()]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <DayNav date={date} category="movies" />
      <MovieEntryForm date={date} initial={day.movies} catalog={catalog} />
    </main>
  );
}
