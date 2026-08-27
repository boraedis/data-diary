import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BooksManageList } from "@/components/manage/books-manage-list";
import { listBooksCatalog } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageBooksPage() {
  const books = await listBooksCatalog();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Books</h1>
        <Link href="/manage/entertainment" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Entertainment
        </Link>
      </div>
      <BooksManageList initial={books} />
    </main>
  );
}
