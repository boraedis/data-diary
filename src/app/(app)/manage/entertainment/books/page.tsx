import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BooksManageList } from "@/components/manage/books-manage-list";
import { listBooksCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageBooksPage() {
  const books = await listBooksCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Books</h1>
        <div className="flex shrink-0 items-center gap-2">
          <Link href="/manage/entertainment/books/watchlist" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Watchlist
          </Link>
          <Link href="/manage/entertainment/books/ranking" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Ranking
          </Link>
          <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Entertainment
          </Link>
        </div>
      </div>
      <BooksManageList initial={books} />
    </main>
  );
}
