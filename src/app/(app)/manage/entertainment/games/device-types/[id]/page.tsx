import { notFound } from "next/navigation";
import { GameDeviceTypeDetail } from "@/components/manage/game-device-type-detail";
import { getGameDeviceType, getGameDeviceTypeUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageGameDeviceTypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const deviceType = await getGameDeviceType(id);
  if (!deviceType) {
    notFound();
    return;
  }
  const usage = await getGameDeviceTypeUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <GameDeviceTypeDetail deviceType={deviceType} usage={usage} />
    </main>
  );
}
