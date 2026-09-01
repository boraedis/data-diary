import { notFound } from "next/navigation";
import { EntertainmentLocationTypeDetail } from "@/components/manage/entertainment-location-type-detail";
import { getEntertainmentLocationType, getEntertainmentLocationTypeUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageEntertainmentLocationTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const type = await getEntertainmentLocationType(id);
  if (!type) {
    notFound();
    return;
  }
  const usage = await getEntertainmentLocationTypeUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <EntertainmentLocationTypeDetail type={type} usage={usage} />
    </main>
  );
}
