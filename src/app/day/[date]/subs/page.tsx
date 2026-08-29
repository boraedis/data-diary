import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { SubsEntryForm } from "@/components/entry-forms/subs-entry-form";
import { isValidDateString } from "@/lib/date";
import { loadDay } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function SubsEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const day = await loadDay(date);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="subs" />
      <SubsEntryForm date={date} initial={{ entries: day.subs }} />
    </main>
  );
}
