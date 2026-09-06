import { notFound } from "next/navigation";
import { ExerciseSubtypeDetail } from "@/components/manage/exercise-subtype-detail";
import { getExerciseSubtype, getExerciseSubtypeUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageExerciseSubtypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const subtype = await getExerciseSubtype(id);
  if (!subtype) {
    notFound();
    return;
  }
  const usage = await getExerciseSubtypeUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <ExerciseSubtypeDetail subtype={subtype} usage={usage} />
    </main>
  );
}
