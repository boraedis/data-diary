import { notFound } from "next/navigation";
import { MetroDetail } from "@/components/manage/metro-detail";
import { getMetro, getMetroUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageMetroPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const metro = await getMetro(id);
  if (!metro) {
    notFound();
    return;
  }
  const usage = await getMetroUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <MetroDetail metro={metro} usage={usage} />
    </main>
  );
}
