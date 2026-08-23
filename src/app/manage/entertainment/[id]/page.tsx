import { notFound } from "next/navigation";
import { EntertainmentDetail } from "@/components/manage/entertainment-detail";
import { getEntertainmentCatalogEntry, getEntertainmentUsage } from "@/lib/days";

export const dynamic = "force-dynamic";

export default async function ManageEntertainmentItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const item = await getEntertainmentCatalogEntry(id);
  if (!item) {
    notFound();
    return;
  }
  const usage = await getEntertainmentUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <EntertainmentDetail item={item} usage={usage} />
    </main>
  );
}
