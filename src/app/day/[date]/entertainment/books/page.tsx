import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { BookEntryForm } from "@/components/entry-forms/book-entry-form";
import { isValidDateString } from "@/lib/date";
import { listBooksCatalog, loadDay } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function BooksEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const [day, catalog] = await Promise.all([loadDay(date), listBooksCatalog()]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <DayNav date={date} category="entertainment/books" />
      <BookEntryForm date={date} initial={day.bookSessions} catalog={catalog} />
    </main>
  );
}
