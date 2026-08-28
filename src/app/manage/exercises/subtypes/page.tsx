import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ExerciseSubtypesManageList } from "@/components/manage/exercise-subtypes-manage-list";
import { listExerciseSubtypes } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageExerciseSubtypesPage() {
  const subtypes = await listExerciseSubtypes();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Exercise subtypes</h1>
        <Link href="/manage/exercises" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Exercises
        </Link>
      </div>
      <ExerciseSubtypesManageList initial={subtypes} />
    </main>
  );
}
