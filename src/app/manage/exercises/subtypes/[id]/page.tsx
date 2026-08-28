import { notFound } from "next/navigation";
import { ExerciseSubtypeDetail } from "@/components/manage/exercise-subtype-detail";
import { getExerciseSubtype } from "@/lib/catalog-admin";

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

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <ExerciseSubtypeDetail subtype={subtype} />
    </main>
  );
}
