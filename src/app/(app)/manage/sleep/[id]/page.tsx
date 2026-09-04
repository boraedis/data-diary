import { notFound } from "next/navigation";
import { SleepLocationTypeDetail } from "@/components/manage/sleep-location-type-detail";
import {
  getSleepLocationType,
  getSleepLocationTypeUsage,
  getSleepLocationSubtypeUsage,
  listSleepLocationTypes,
} from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageSleepLocationTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const type = await getSleepLocationType(id);
  if (!type) {
    notFound();
    return;
  }
  const [usage, allTypes] = await Promise.all([getSleepLocationTypeUsage(id), listSleepLocationTypes()]);
  const subtypeList = allTypes.find((t) => t.id === id)?.subtypes ?? [];
  const subtypes = await Promise.all(
    subtypeList.map(async (s) => ({ ...s, usage: await getSleepLocationSubtypeUsage(s.id) }))
  );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <SleepLocationTypeDetail type={type} usage={usage} subtypes={subtypes} />
    </main>
  );
}
