import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { MoviesManageList } from "@/components/manage/movies-manage-list";
import { listMoviesCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageMoviesPage() {
  const movies = await listMoviesCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Movies</h1>
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Entertainment
        </Link>
      </div>
      <MoviesManageList initial={movies} />
    </main>
  );
}
