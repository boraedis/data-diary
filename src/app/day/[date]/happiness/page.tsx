import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { HappinessEntryForm } from "@/components/entry-forms/happiness-entry-form";
import { isValidDateString } from "@/lib/date";
import { loadDay } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function HappinessEntryPage({
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
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <DayNav date={date} category="happiness" />
      <HappinessEntryForm
        date={date}
        initial={{
          happiness: day.happiness,
          happinessReason: day.happinessReason,
          journal: day.journal,
          dayType: day.dayType,
        }}
      />
    </main>
  );
}
