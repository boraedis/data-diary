import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ExercisesManageList } from "@/components/manage/exercises-manage-list";
import { listExercisesCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageExercisesPage() {
  const exercises = await listExercisesCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Exercises</h1>
        <Link href="/manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Manage Home
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
