import { notFound } from "next/navigation";
import { PlaceDetail } from "@/components/manage/place-detail";
import { getPlaceCatalogEntry, getPlaceUsage } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManagePlacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const place = await getPlaceCatalogEntry(id);
  if (!place) {
    notFound();
    return;
  }
  const usage = await getPlaceUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <PlaceDetail place={place} usage={usage} />
    </main>
  );
}
