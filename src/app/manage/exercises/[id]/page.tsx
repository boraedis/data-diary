import { notFound } from "next/navigation";
import { ExerciseDetail } from "@/components/manage/exercise-detail";
import { getExerciseCatalogEntry, getExerciseUsage } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const exercise = await getExerciseCatalogEntry(id);
  if (!exercise) {
    notFound();
    return;
  }
  const usage = await getExerciseUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <ExerciseDetail exercise={exercise} usage={usage} />
    </main>
  );
}
