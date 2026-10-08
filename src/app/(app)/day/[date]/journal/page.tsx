import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { JournalSection, type JournalMode } from "@/components/journal/journal-section";
import { isValidDateString } from "@/lib/date";
import { loadDay } from "@/lib/days";

export const dynamic = "force-dynamic";

/** The day's journal, written or recorded (#340, epic #338). Moved out of
 * the Happiness section into its own once video journaling made it a
 * primary way of logging a day rather than one field among four. */
export default async function JournalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }
  const { mode } = await searchParams;
  const initialMode: JournalMode = mode === "record" ? "record" : "write";

  const day = await loadDay(date);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="journal" />
      <JournalSection date={date} initialMode={initialMode} initialJournal={day.journal} />
    </main>
  );
}
