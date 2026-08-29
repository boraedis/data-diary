import { notFound } from "next/navigation";
import { ExerciseFocusDetail } from "@/components/manage/exercise-focus-detail";
import { getExerciseFocus, getExerciseFocusUsage, getExerciseSubfocusUsage, listExerciseFocuses } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageExerciseFocusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const focus = await getExerciseFocus(id);
  if (!focus) {
    notFound();
    return;
  }
  const [usage, allFocuses] = await Promise.all([getExerciseFocusUsage(id), listExerciseFocuses()]);
  const subfocusList = allFocuses.find((f) => f.id === id)?.subfocuses ?? [];
  const subfocuses = await Promise.all(
    subfocusList.map(async (s) => ({ ...s, usage: await getExerciseSubfocusUsage(s.id) }))
  );
  const otherFocuses = allFocuses.filter((f) => f.id !== id).map((f) => ({ id: f.id, name: f.name }));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <ExerciseFocusDetail focus={focus} usage={usage} subfocuses={subfocuses} otherFocuses={otherFocuses} />
    </main>
  );
}
