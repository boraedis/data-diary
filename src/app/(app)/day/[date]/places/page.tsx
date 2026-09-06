import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { PlacesEntryForm } from "@/components/entry-forms/places-entry-form";
import { isValidDateString } from "@/lib/date";
import { getPlaceMentionCounts, getRawPlaceMentionCounts, listPlacesCatalog, loadDay } from "@/lib/days";
import { listMetros, listPlaceCategories } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function PlacesEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const [day, catalog, mentionCounts, rawMentionCounts, categories, metros] = await Promise.all([
    loadDay(date),
    listPlacesCatalog(),
    getPlaceMentionCounts(),
    getRawPlaceMentionCounts(),
    listPlaceCategories(),
    listMetros(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="places" manageHref="/manage/places" manageLabel="Manage places" />
      <PlacesEntryForm
        date={date}
        initial={{ entries: day.places }}
        catalog={catalog}
        mentionCounts={mentionCounts}
        rawMentionCounts={rawMentionCounts}
        categories={categories}
        metros={metros}
      />
    </main>
  );
}
