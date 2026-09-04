import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { MovieRankingManage } from "@/components/manage/movie-ranking-manage";
import { listMoviesCatalog, listMovieRanking } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function MovieRankingPage() {
  const [ranking, movies] = await Promise.all([listMovieRanking(), listMoviesCatalog()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Top 10 movies</h1>
        <Link href="/manage/entertainment/movies" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Movies
        </Link>
      </div>
      <MovieRankingManage initial={ranking} allMovies={movies} />
    </main>
  );
}
