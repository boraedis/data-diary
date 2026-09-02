import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { GameDeviceTypesManageList } from "@/components/manage/game-device-types-manage-list";
import { listGameDeviceTypes } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageGameDeviceTypesPage() {
  const deviceTypes = await listGameDeviceTypes();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8 md:max-w-2xl md:gap-6 md:py-12">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-medium tracking-tight md:text-3xl">Device types</h1>
        <Link href="/manage/entertainment/games" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Games
        </Link>
      </div>
      <GameDeviceTypesManageList initial={deviceTypes} />
    </main>
  );
}
