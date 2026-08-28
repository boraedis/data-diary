import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { MetrosManageList } from "@/components/manage/metros-manage-list";
import { listMetros } from "@/lib/catalog-admin";

export const dynamic = "force-dynamic";

export default async function ManageMetrosPage() {
  const metros = await listMetros();

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Metros</h1>
        <Link href="/manage/places" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Places
        </Link>
      </div>
      <MetrosManageList initial={metros} />
    </main>
  );
}
