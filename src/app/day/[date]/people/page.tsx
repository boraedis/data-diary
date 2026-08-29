import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { PeopleEntryForm } from "@/components/entry-forms/people-entry-form";
import { listTags } from "@/lib/catalog-admin";
import { isValidDateString } from "@/lib/date";
import { listPeopleCatalog, loadDay } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function PeopleEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const [day, catalog, tags] = await Promise.all([loadDay(date), listPeopleCatalog(), listTags()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="people" />
      <PeopleEntryForm date={date} initial={{ entries: day.people }} catalog={catalog} tags={tags} />
    </main>
  );
}
