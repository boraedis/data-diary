import { notFound } from "next/navigation";
import { TvShowDetail } from "@/components/manage/tvshow-detail";
import { getTvShowCatalogEntry, getTvShowUsage } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageTvShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const show = await getTvShowCatalogEntry(id);
  if (!show) {
    notFound();
    return;
  }
  const usage = await getTvShowUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <TvShowDetail show={show} usage={usage} />
    </main>
  );
}
