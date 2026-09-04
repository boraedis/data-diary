import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BookWatchlistManage } from "@/components/manage/book-watchlist-manage";
import { listBooksCatalog, listBookWatchlist } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function BookWatchlistPage() {
  const [watchlist, books] = await Promise.all([listBookWatchlist(), listBooksCatalog()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Book watchlist</h1>
        <Link href="/manage/entertainment/books" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Books
        </Link>
      </div>
      <BookWatchlistManage initial={watchlist} allBooks={books} />
    </main>
  );
}
