import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { MovieWatchlistManage } from "@/components/manage/movie-watchlist-manage";
import { listMoviesCatalog, listMovieWatchlist } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function MovieWatchlistPage() {
  const [watchlist, movies] = await Promise.all([listMovieWatchlist(), listMoviesCatalog()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Movie watchlist</h1>
        <Link href="/manage/entertainment/movies" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Movies
        </Link>
      </div>
      <MovieWatchlistManage initial={watchlist} allMovies={movies} />
    </main>
  );
}
