import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { EntertainmentEntryForm } from "@/components/entry-forms/entertainment-entry-form";
import { isValidDateString } from "@/lib/date";
import { listEntertainmentCatalog, loadDay } from "@/lib/days";
import { listEntertainmentKinds } from "@/lib/catalog-admin";

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

  const [day, catalog, kinds] = await Promise.all([loadDay(date), listEntertainmentCatalog(), listEntertainmentKinds()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="entertainment" />
      <EntertainmentEntryForm date={date} initial={day.entertainment} catalog={catalog} kinds={kinds} />
    </main>
  );
}
