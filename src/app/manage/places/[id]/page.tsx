import { notFound } from "next/navigation";
import { PlaceDetail } from "@/components/manage/place-detail";
import {
  getPlaceAncestry,
  getPlaceCatalogEntry,
  getPlaceChildren,
  getPlaceDescendantIds,
  getPlaceUsage,
  listPlacesCatalog,
} from "@/lib/days";
import { listMetros, listPlaceCategories } from "@/lib/catalog-admin";

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

  const [usage, ancestry, children, metros, categories, allPlaces, descendantIds] = await Promise.all([
    getPlaceUsage(id),
    getPlaceAncestry(id),
    getPlaceChildren(id),
    listMetros(),
    listPlaceCategories(),
    listPlacesCatalog(),
    getPlaceDescendantIds(id),
  ]);

  const excluded = new Set([id, ...descendantIds]);
  const parentOptions = allPlaces.filter((p) => !excluded.has(p.id)).map((p) => ({ id: p.id, name: p.name }));

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <PlaceDetail
        place={place}
        usage={usage}
        ancestry={ancestry}
        children={children}
        metros={metros}
        parentOptions={parentOptions}
        categories={categories}
      />
    </main>
  );
}
