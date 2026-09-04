import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BookRankingManage } from "@/components/manage/book-ranking-manage";
import { listBooksCatalog, listBookRanking } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function BookRankingPage() {
  const [ranking, books] = await Promise.all([listBookRanking(), listBooksCatalog()]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Top 10 books</h1>
        <Link href="/manage/entertainment/books" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Books
        </Link>
      </div>
      <BookRankingManage initial={ranking} allBooks={books} />
    </main>
  );
}
