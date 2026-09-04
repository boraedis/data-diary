import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { SleepEntryForm } from "@/components/entry-forms/sleep-entry-form";
import { isValidDateString } from "@/lib/date";
import { loadDay } from "@/lib/days";
import { listSleepLocationTypes } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function SleepEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const [day, sleepLocationTypes] = await Promise.all([loadDay(date), listSleepLocationTypes()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="sleep" manageHref="/manage/sleep" manageLabel="Manage sleep" />
      <SleepEntryForm
        date={date}
        initial={{
          sleepTime: day.sleepTime,
          wakeTime: day.wakeTime,
          wakeCrossedMidnight: day.wakeCrossedMidnight,
          sleepLocationType: day.sleepLocationType,
          sleepLocationSubtype: day.sleepLocationSubtype,
          napMinutes: day.napMinutes,
        }}
        initialLocationTypes={sleepLocationTypes}
      />
    </main>
  );
}
