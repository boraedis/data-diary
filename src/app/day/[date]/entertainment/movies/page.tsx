import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { MovieEntryForm } from "@/components/entry-forms/movie-entry-form";
import { isValidDateString } from "@/lib/date";
import { listMoviesCatalog, loadDay } from "@/lib/days";
import { listEntertainmentLocationTypes } from "@/lib/catalog-admin";

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

  const [day, catalog, locationTypes] = await Promise.all([
    loadDay(date),
    listMoviesCatalog(),
    listEntertainmentLocationTypes(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="entertainment/movies" />
      <MovieEntryForm date={date} initial={day.movies} catalog={catalog} locationTypes={locationTypes} />
    </main>
  );
}
