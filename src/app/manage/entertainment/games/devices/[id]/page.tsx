import { notFound } from "next/navigation";
import { GameDeviceDetail } from "@/components/manage/game-device-detail";
import { getGameDevice, getGameDeviceUsage } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageGameDevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) {
    notFound();
  }

  const device = await getGameDevice(id);
  if (!device) {
    notFound();
    return;
  }
  const usage = await getGameDeviceUsage(id);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <GameDeviceDetail device={device} usage={usage} />
    </main>
  );
}
