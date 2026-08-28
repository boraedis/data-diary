import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ExercisesManageList } from "@/components/manage/exercises-manage-list";
import { listExercisesCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageExercisesPage() {
  const exercises = await listExercisesCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Exercises</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage
        </Link>
      </div>
      <div className="flex justify-end gap-2">
        <Link href="/manage/exercises/focuses" className={buttonVariants({ variant: "outline", size: "xs" })}>
          Focuses
        </Link>
        <Link href="/manage/exercises/subtypes" className={buttonVariants({ variant: "outline", size: "xs" })}>
          Subtypes
        </Link>
      </div>
      <ExercisesManageList initial={exercises} />
    </main>
  );
}
