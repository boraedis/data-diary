import { notFound } from "next/navigation";
import { DayNav } from "@/components/day-nav";
import { HealthEntryForm } from "@/components/entry-forms/health-entry-form";
import { isValidDateString } from "@/lib/date";
import { listExercisesCatalog, listPlacesCatalog, loadDay } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function HealthEntryPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDateString(date)) {
    notFound();
  }

  const [day, exerciseCatalog, placeCatalog] = await Promise.all([
    loadDay(date),
    listExercisesCatalog(),
    listPlacesCatalog(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <DayNav date={date} category="health" />
      <HealthEntryForm
        date={date}
        initial={{
          distanceWalkedKm: day.distanceWalkedKm,
          coffees: day.coffees,
          sick: day.sick,
          workouts: day.workouts,
        }}
        exerciseCatalog={exerciseCatalog}
        placeCatalog={placeCatalog}
      />
    </main>
  );
}
