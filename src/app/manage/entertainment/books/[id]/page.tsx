import { notFound } from "next/navigation";
import { BookDetail } from "@/components/manage/book-detail";
import { getBookCatalogEntry, getBookProgress, getBookUsage } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageBookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const book = await getBookCatalogEntry(id);
  if (!book) {
    notFound();
    return;
  }
  const [usage, progress] = await Promise.all([getBookUsage(id), getBookProgress(id)]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <BookDetail book={book} usage={usage} progress={progress} />
    </main>
  );
}
