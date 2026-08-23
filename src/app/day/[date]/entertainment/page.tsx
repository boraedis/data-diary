import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { DayNav } from "@/components/day-nav";
import { EntertainmentEntryForm } from "@/components/entry-forms/entertainment-entry-form";
import { isValidDateString } from "@/lib/date";
import { listEntertainmentCatalog, loadDay } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function EntertainmentEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const [day, catalog] = await Promise.all([loadDay(date), listEntertainmentCatalog()]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <DayNav date={date} category="entertainment" />

      {/* Movies has its own real TMDB-backed form now, reached from here as
       * one of entertainment's kinds rather than shown as a sibling
       * day-summary tile. TV/books/sports/games will get the same "+ card
       * here, form lives under entertainment/<kind>" treatment as their
       * real forms land; until then they stay on the generic form below. */}
      <Link href={`/day/${date}/entertainment/movies`}>
        <Card size="sm" className="transition-colors hover:bg-accent">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Movies</CardTitle>
              <span className="font-mono text-sm text-muted-foreground">{day.movies.length} logged</span>
            </div>
          </CardHeader>
        </Card>
      </Link>

      <EntertainmentEntryForm date={date} initial={day.entertainment} catalog={catalog} />
    </main>
  );
}
