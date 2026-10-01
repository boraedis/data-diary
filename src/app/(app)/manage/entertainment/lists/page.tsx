import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EntertainmentListsView, type EntertainmentTypeLists } from "@/components/manage/entertainment-lists-view";
import { listBookRanking, listBookWatchlist, listMovieRanking, listMovieWatchlist } from "@/lib/days";

export const dynamic = "force-dynamic";

// Read-only overview of every ranking and watchlist (#549). Movies and books
// are the only types with either; each gets a section here, mapped from the
// same readers the per-type pages use. Add a type once it has a list.

const year = (date: string | null) => (date ? date.slice(0, 4) : null);
const addedOn = (date: string | null) => (date ? `Added ${date}` : null);

export default async function EntertainmentListsPage() {
  const [movieRanking, movieWatchlist, bookRanking, bookWatchlist] = await Promise.all([
    listMovieRanking(),
    listMovieWatchlist(),
    listBookRanking(),
    listBookWatchlist(),
  ]);

  const types: EntertainmentTypeLists[] = [
    {
      type: "Movies",
      lists: [
        {
          label: "Top 10",
          ranked: true,
          editHref: "/manage/entertainment/movies/ranking",
          entries: movieRanking.map((m) => ({
            id: m.movieId,
            title: m.title,
            detail: year(m.releaseDate),
            href: `/manage/entertainment/movies/${m.movieId}`,
          })),
        },
        {
          label: "Watchlist",
          ranked: false,
          editHref: "/manage/entertainment/movies/watchlist",
          entries: movieWatchlist.map((m) => ({
            id: m.movieId,
            title: m.title,
            detail: [year(m.releaseDate), addedOn(m.addedAt)].filter(Boolean).join(" · "),
            href: `/manage/entertainment/movies/${m.movieId}`,
          })),
        },
      ],
    },
    {
      type: "Books",
      lists: [
        {
          label: "Top 10",
          ranked: true,
          editHref: "/manage/entertainment/books/ranking",
          entries: bookRanking.map((b) => ({
            id: b.bookId,
            title: b.title,
            detail: b.authors.join(", "),
            href: `/manage/entertainment/books/${b.bookId}`,
          })),
        },
        {
          label: "Watchlist",
          ranked: false,
          editHref: "/manage/entertainment/books/watchlist",
          entries: bookWatchlist.map((b) => ({
            id: b.bookId,
            title: b.title,
            detail: [b.authors.join(", "), addedOn(b.addedAt)].filter(Boolean).join(" · "),
            href: `/manage/entertainment/books/${b.bookId}`,
          })),
        },
      ],
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Rankings &amp; watchlists</h1>
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Entertainment
        </Link>
      </div>
      <EntertainmentListsView types={types} />
    </main>
  );
}
